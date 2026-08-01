import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { SyncClient } from "@/api/sync/sync-client"
import { createLogger } from "@/api/common/logger"
import { SYNCABLE_EVENT_TYPES } from "@/types/DomainEvent"

const logger = createLogger("SyncEngine")

const DEFAULT_BATCH_LIMIT = 50

// Caps how many pages a single flush() call will drain before yielding,
// so an unusually large backlog (e.g. hours offline with sync on) can't
// starve the rest of the app on one call - the next trigger (outbox
// change, foreground, safety interval, ack) continues where this left off.
// 20 batches * 50 events/batch = 1000 events per flush() call.
export const MAX_DRAIN_BATCHES = 20

/**
 * Orchestrates getting outbox rows to the server and reconciling local
 * belief with server reality.
 *
 * Deliberately does not persist an in-flight/"sent" status anywhere - see
 * outbox-repository.ts for why. A row only ever moves out of "pending" via
 * handleAck (a WebSocket ack, meaning the server actually committed it) or
 * via reconcile confirming the server already has it. A successful POST by
 * itself proves nothing beyond "the server accepted the batch to process
 * later", so flush() never marks anything synced.
 */
export class SyncEngine {
  private readonly inFlight = new Set<string>()
  private flushing = false

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly eventRepository: EventRepository,
    private readonly client: SyncClient,
    private readonly batchLimit: number = DEFAULT_BATCH_LIMIT
  ) {}

  /**
   * Drains the outbox a page at a time (via getPending's keyset
   * pagination), not just one page - the previous behaviour of sending a
   * single 50-row page per call meant a large backlog (e.g. hours offline
   * with a big list synced) only shrank by one page per unrelated trigger
   * (foreground, outbox change, safety interval), and a naive `while
   * (pending.length > 0)` loop can't terminate here since rows only leave
   * "pending" via an ack or reconcile, never as a side effect of sending -
   * the keyset cursor (not row status) is what proves progress.
   *
   * Stops when a short page proves the backlog is drained, when sending
   * fails (no point hammering a network/server that just rejected us - the
   * next trigger picks up from here), or after MAX_DRAIN_BATCHES pages as a
   * safety valve.
   */
  async flush(): Promise<void> {
    if (this.flushing) {
      // A flush is already in progress; let it finish rather than
      // overlapping two sends of the same rows.
      return
    }
    this.flushing = true

    try {
      let after: string | undefined
      for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
        const pendingResult = await this.outboxRepository.getPending(
          this.batchLimit,
          after
        )
        if (!pendingResult.success) {
          logger.error(
            "Failed to load pending outbox rows",
            pendingResult.getError()
          )
          return
        }

        const page = pendingResult.getValue()!
        if (page.length === 0) {
          return
        }
        // Advance the cursor from the full page, independent of the
        // inFlight filter below, so pagination can't stall on a row that
        // happens to already be in flight.
        after = page[page.length - 1].event_id

        const pending = page.filter((row) => !this.inFlight.has(row.event_id))
        if (pending.length === 0) {
          continue
        }

        const eventIds = pending.map((row) => row.event_id)
        const eventsResult = await this.eventRepository.getByEventIds(eventIds)
        if (!eventsResult.success) {
          logger.error(
            "Failed to load events for pending outbox rows",
            eventsResult.getError()
          )
          return
        }
        const events = eventsResult.getValue()!
        if (events.length === 0) {
          continue
        }

        eventIds.forEach((id) => this.inFlight.add(id))
        let sendFailed = false
        try {
          const sendResult = await this.client.sendEvents(events)
          const now = Date.now()
          for (const id of eventIds) {
            await this.outboxRepository.bumpAttempt(id, now)
          }
          if (!sendResult.success) {
            logger.warn("Failed to send events", sendResult.getError())
            sendFailed = true
          }
        } finally {
          eventIds.forEach((id) => this.inFlight.delete(id))
        }

        if (sendFailed) {
          return
        }
        if (page.length < this.batchLimit) {
          // Short page - nothing more to drain right now.
          return
        }
      }
    } finally {
      this.flushing = false
    }
  }

  /** The server confirmed (via WebSocket) that this event actually committed. */
  async handleAck(eventId: string): Promise<void> {
    const result = await this.outboxRepository.markSynced(eventId)
    if (!result.success) {
      logger.error(
        `Failed to mark event ${eventId} as synced`,
        result.getError()
      )
    }
  }

  /**
   * Self-heal: for the given (sync-enabled) aggregate ids, compares the
   * syncable events we have locally against what the server reports it
   * durably holds. Anything missing from the server is queued (or
   * re-queued, if the local outbox already thought it was synced) and
   * flushed immediately - this is what recovers from a lost ack, an app
   * kill between send and ack, or the server losing data it had
   * previously acked.
   */
  async reconcile(aggregateIds: string[]): Promise<void> {
    if (aggregateIds.length === 0) {
      return
    }

    const knownResult = await this.client.getKnownEventIds(aggregateIds)
    if (!knownResult.success) {
      logger.warn(
        "Reconcile failed, will retry on the next trigger",
        knownResult.getError()
      )
      return
    }
    const known = new Set(knownResult.getValue()!)

    for (const aggregateId of aggregateIds) {
      const eventsResult =
        await this.eventRepository.getByAggregateId(aggregateId)
      if (!eventsResult.success) {
        logger.warn(
          `Reconcile: failed to load history for ${aggregateId}`,
          eventsResult.getError()
        )
        continue
      }

      const missing = eventsResult
        .getValue()!
        .filter(
          (event) =>
            SYNCABLE_EVENT_TYPES.includes(event.event_type) &&
            !known.has(event.event_id)
        )
      if (missing.length === 0) {
        continue
      }

      // enqueueExistingForSync creates a fresh (pending) row for anything
      // never queued before; resetToPending forces any existing row - even
      // one already marked synced - back to pending. Together they cover
      // both "never sent" and "server lost what it had acked".
      await this.eventRepository.enqueueExistingForSync(missing)
      await this.outboxRepository.resetToPending(
        missing.map((event) => event.event_id)
      )
    }

    await this.flush()
  }
}
