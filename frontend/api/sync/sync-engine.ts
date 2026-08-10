import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { SyncClient } from "@/api/sync/sync-client"
import { EventApplier } from "@/api/sync/event-applier"
import { createLogger } from "@/api/common/logger"
import { SYNCABLE_EVENT_TYPES } from "@/types/DomainEvent"

const logger = createLogger("SyncEngine")

const DEFAULT_BATCH_LIMIT = 50
const DEFAULT_PULL_PAGE_LIMIT = 200
// Mirrors the backend's maxSyncListIDs cap on /api/v1/sync/state; chunk
// defensively rather than risk a rejected reconcile call.
const MAX_RECONCILE_LIST_IDS = 200

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

// Safety valve so one flush() call can't be starved by an unbounded
// backlog; the next trigger continues the drain. See flush()'s doc comment
// and sync-design-decisions.md.
export const MAX_DRAIN_BATCHES = 20

/**
 * Orchestrates getting outbox rows to the server and reconciling local
 * belief with server reality. Never marks a row synced on POST alone -
 * only handleAck (a WebSocket ack) or reconcile confirms it landed. See
 * sync-design-decisions.md ("Kein persistierter 'sent'-Zustand").
 */
export class SyncEngine {
  private readonly inFlight = new Set<string>()
  private flushing = false
  // Serializes handleAck() end-to-end - see its doc comment for why two
  // acks for the same list must never process concurrently. Deliberately a
  // separate queue from write-lock.ts's runExclusive: handleAckOrdered's
  // own steps (markSynced, markSeq, rebuildForAck) already funnel through
  // that queue internally, and nesting the same queue inside itself here
  // would deadlock (see EventApplier's class doc for the same hazard).
  private ackQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly eventRepository: EventRepository,
    private readonly client: SyncClient,
    private readonly cursorRepository: SyncCursorRepository,
    private readonly eventApplier: EventApplier,
    private readonly batchLimit: number = DEFAULT_BATCH_LIMIT,
    private readonly pullPageLimit: number = DEFAULT_PULL_PAGE_LIMIT
  ) {}

  /**
   * Drains the outbox via getPending's keyset pagination, not a naive
   * `while (pending.length > 0)` loop - rows never leave "pending" as a
   * side effect of sending, only via ack/reconcile, so the keyset cursor
   * (not row status) is what proves progress. Stops on a short page, a
   * send failure, or after MAX_DRAIN_BATCHES pages. See
   * sync-design-decisions.md.
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
        // Advance from the full page, not the inFlight-filtered one below,
        // so pagination can't stall on a row already in flight.
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

  /**
   * The server confirmed (via WebSocket) that this event committed, at
   * position `seq`. Marks the outbox row synced and, for a first-time ack,
   * records the seq and rebuilds the affected list (byServerSeqThenLocal).
   * See sync-design-decisions.md ("Ack trägt seq mit").
   *
   * Queued onto ackQueue rather than run directly: SyncSocket dispatches
   * each "ack" message via a synchronous, unawaited callback, so two acks
   * for the same list could otherwise finish processing in whichever order
   * their own awaits happen to resolve, not necessarily arrival order -
   * letting byServerSeqThenLocal sort a later-seq event before an
   * earlier-seq one that's still locally unconfirmed (e.g. replaying
   * todo_list.sync_enabled before todo_list.created no-ops the UPDATE, and
   * the following handleCreated INSERT re-creates the row with the
   * column's default). Queuing guarantees each ack's write+rebuild fully
   * completes, in arrival order, before the next one starts.
   */
  async handleAck(eventId: string, seq: number): Promise<void> {
    const run = this.ackQueue.then(() => this.handleAckOrdered(eventId, seq))
    this.ackQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async handleAckOrdered(eventId: string, seq: number): Promise<void> {
    const result = await this.outboxRepository.markSynced(eventId)
    if (!result.success) {
      logger.error(
        `Failed to mark event ${eventId} as synced`,
        result.getError()
      )
    }

    const eventsResult = await this.eventRepository.getByEventIds([eventId])
    if (!eventsResult.success) {
      logger.error(
        `Failed to look up acked event ${eventId}`,
        eventsResult.getError()
      )
      return
    }
    const event = eventsResult.getValue()![0]
    if (!event || event.seq !== null) {
      return
    }

    const seqResult = await this.eventRepository.markSeq(eventId, seq)
    if (!seqResult.success) {
      logger.error(
        `Failed to record seq for event ${eventId}`,
        seqResult.getError()
      )
      return
    }

    if (event.list_id) {
      const rebuildResult = await this.eventApplier.rebuildForAck(event.list_id)
      if (!rebuildResult.success) {
        logger.error(
          `Failed to rebuild list ${event.list_id} after ack`,
          rebuildResult.getError()
        )
      }
    }
  }

  /**
   * Self-heal: compares the syncable events we hold locally for these
   * (sync-enabled) lists against what the server durably holds, re-queues
   * anything missing, and flushes - recovers from a lost ack, an app kill
   * between send and ack, or the server losing previously-acked data.
   * Keyed by list_id, not aggregate_id - see sync-design-decisions.md.
   */
  async reconcile(listIds: string[]): Promise<void> {
    if (listIds.length === 0) {
      return
    }

    for (const batch of chunk(listIds, MAX_RECONCILE_LIST_IDS)) {
      await this.reconcileBatch(batch)
    }

    await this.flush()
  }

  private async reconcileBatch(listIds: string[]): Promise<void> {
    const knownResult = await this.client.getKnownEventIds(listIds)
    if (!knownResult.success) {
      logger.warn(
        "Reconcile failed, will retry on the next trigger",
        knownResult.getError()
      )
      return
    }
    const known = new Set(knownResult.getValue()!)

    for (const listId of listIds) {
      const eventsResult = await this.eventRepository.getByListId(listId)
      if (!eventsResult.success) {
        logger.warn(
          `Reconcile: failed to load history for list ${listId}`,
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
  }

  /**
   * For each sync-enabled list, compares the server's head against our
   * local cursor and pulls whatever's missing, then flushes - pull runs
   * first so local state reflects remote before anything new goes out.
   */
  async pull(listIds: string[]): Promise<void> {
    if (listIds.length === 0) {
      return
    }

    const headsResult = await this.client.getListHeads(listIds)
    if (!headsResult.success) {
      logger.warn(
        "Failed to fetch list heads, will retry on the next trigger",
        headsResult.getError()
      )
      return
    }
    const headByListId = new Map(
      headsResult.getValue()!.map((head) => [head.listId, head])
    )

    for (const listId of listIds) {
      const head = headByListId.get(listId)
      if (!head) {
        // The server answers every requested id (see SyncPullController);
        // a missing entry would mean a response we can't trust - skip
        // rather than guess.
        continue
      }
      await this.pullListToHead(listId, head.seq)
    }

    await this.flush()
  }

  /** Single-list entry point - e.g. a WebSocket "new event for this list" notification. */
  async pullList(listId: string): Promise<void> {
    await this.pull([listId])
  }

  private async pullListToHead(listId: string, headSeq: number): Promise<void> {
    const cursorResult = await this.cursorRepository.get(listId)
    if (!cursorResult.success) {
      // A real local DB error, not "never pulled before" (that's a
      // success with a null value, treated as seq 0 below) - don't mask it
      // as an empty cursor, which would force an unnecessary full pull.
      // Skip this list; the next trigger retries.
      logger.error(
        `Failed to read pull cursor for list ${listId}`,
        cursorResult.getError()
      )
      return
    }
    const cursorSeq = cursorResult.getValue()?.last_seen_seq ?? 0

    if (headSeq < cursorSeq) {
      // The server's head is behind what we last saw - it lost data (e.g.
      // restored from an older backup). Clamp our cursor down to what it
      // actually has; reconcile resends anything it's missing from what we
      // hold locally.
      logger.warn(
        `Server head for list ${listId} (seq ${headSeq}) is behind our cursor (seq ${cursorSeq}) - clamping down`
      )
      await this.cursorRepository.set(listId, headSeq, Date.now())
      return
    }

    if (headSeq === cursorSeq) {
      // Already caught up - nothing to pull for this list.
      return
    }

    let since = cursorSeq
    let hasMore = true
    while (hasMore) {
      const pageResult = await this.client.getEventsSince(
        listId,
        since,
        this.pullPageLimit
      )
      if (!pageResult.success) {
        logger.warn(
          `Failed to pull events for list ${listId}, will retry on the next trigger`,
          pageResult.getError()
        )
        return
      }
      const page = pageResult.getValue()!

      if (page.events.length > 0) {
        const applyResult = await this.eventApplier.apply(
          listId,
          page.events,
          page.nextSeq
        )
        if (!applyResult.success) {
          logger.error(
            `Failed to apply pulled events for list ${listId}`,
            applyResult.getError()
          )
          return
        }
      }

      since = page.nextSeq
      hasMore = page.hasMore
    }
  }
}
