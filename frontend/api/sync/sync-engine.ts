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
// Mirrors the backend's maxSyncListIDs cap on /api/v1/sync/state - nobody
// realistically has this many synced lists, but the cap is enforced
// server-side regardless, so chunk defensively rather than ever risk a
// rejected reconcile call.
const MAX_RECONCILE_LIST_IDS = 200

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

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
    private readonly cursorRepository: SyncCursorRepository,
    private readonly eventApplier: EventApplier,
    private readonly batchLimit: number = DEFAULT_BATCH_LIMIT,
    private readonly pullPageLimit: number = DEFAULT_PULL_PAGE_LIMIT
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
   * Self-heal: for the given (sync-enabled) list ids, compares the
   * syncable events we have locally against what the server reports it
   * durably holds. Anything missing from the server is queued (or
   * re-queued, if the local outbox already thought it was synced) and
   * flushed immediately - this is what recovers from a lost ack, an app
   * kill between send and ack, or the server losing data it had
   * previously acked.
   *
   * Keyed by list_id, not aggregate_id: aggregate_id is the ingredient id
   * for ingredient.* events, so a client would otherwise have to enumerate
   * every ingredient id in a list instead of the one list_id it already
   * has (see /api/v1/sync/state's clean break to list_ids and
   * sync-design-decisions.md).
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
   * The pull decision point: for each sync-enabled list, compares the
   * server's head (fetched in one batched request) against our locally
   * stored cursor, and pulls whatever's missing. Always finishes with a
   * flush() - pull runs first so local state reflects remote before
   * anything new goes out, but a list that's already caught up on pull
   * still needs its pending outbox rows (new local writes, or another
   * list's toggle-sync-on replay) pushed.
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
    const cursorSeq = cursorResult.success
      ? (cursorResult.getValue()?.last_seen_seq ?? 0)
      : 0

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
