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
   * The server confirmed (via WebSocket) that this event committed. Marks
   * the outbox row synced - that's all. `seq` has exactly one writer (the
   * pull path, see EventRepository.insertRemote): the ack doesn't record
   * it, so it never has to race pull for ordering. See
   * sync-design-decisions.md ("Genau ein Writer für seq") for why a second,
   * out-of-band writer here made "unconfirmed" ambiguous - it used to mean
   * either "not yet sent" or "the server has this, we just lost the ack" -
   * and made every ack a potential list rebuild, ordering-sensitive across
   * concurrent acks. Losing an ack is now harmless: the event simply stays
   * in the local unconfirmed tail until the next pull assigns it a seq.
   */
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
   * Self-heal, both directions: compares the syncable events we hold
   * locally for these (sync-enabled) lists against what the server durably
   * holds. Server missing something we have → re-queue it (recovers from an
   * app kill between send and ack, or the server losing previously-acked
   * data). Server already has something we still show as locally
   * unconfirmed, *and* we've caught up to the server's head → repairList()
   * re-derives that list from scratch (recovers from local/server ordering
   * drift, see repairList's doc comment - the "caught up" guard matters
   * because seq === null is also the normal state of a just-acked,
   * not-yet-pulled event). Keyed by list_id, not aggregate_id - see
   * sync-design-decisions.md.
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

    // Needed for the drift guard below; a failure here just disables that
    // guard for this batch; the missing-event direction still runs.
    const headsResult = await this.client.getListHeads(listIds)
    if (!headsResult.success) {
      logger.warn(
        "Reconcile: failed to fetch list heads, skipping drift check for this batch",
        headsResult.getError()
      )
    }
    const headSeqByListId = new Map(
      (headsResult.success ? headsResult.getValue()! : []).map((head) => [
        head.listId,
        head.seq,
      ])
    )

    for (const listId of listIds) {
      const eventsResult = await this.eventRepository.getByListId(listId)
      if (!eventsResult.success) {
        logger.warn(
          `Reconcile: failed to load history for list ${listId}`,
          eventsResult.getError()
        )
        continue
      }
      const syncable = eventsResult
        .getValue()!
        .filter((event) => SYNCABLE_EVENT_TYPES.includes(event.event_type))

      const missing = syncable.filter((event) => !known.has(event.event_id))
      if (missing.length > 0) {
        // enqueueExistingForSync creates a fresh (pending) row for anything
        // never queued before; resetToPending forces any existing row -
        // even one already marked synced - back to pending. Together they
        // cover both "never sent" and "server lost what it had acked".
        await this.eventRepository.enqueueExistingForSync(missing)
        await this.outboxRepository.resetToPending(
          missing.map((event) => event.event_id)
        )
      }

      // The opposite direction: the server already knows an event we still
      // show as locally unconfirmed. Under the single-seq-writer invariant
      // (sync-design-decisions.md, "Genau ein Writer für seq") that's the
      // normal state of anything just pushed and acked but not yet pulled -
      // it only means drift once our cursor has reached the server's head,
      // since a pull that hasn't happened yet can't be blamed for not
      // having assigned a seq.
      const hasUnpulledKnownEvent = syncable.some(
        (event) => event.seq === null && known.has(event.event_id)
      )
      if (!hasUnpulledKnownEvent) {
        continue
      }
      const headSeq = headSeqByListId.get(listId)
      if (headSeq === undefined) {
        continue
      }
      const cursorSeq = await this.readCursorSeq(listId)
      if (cursorSeq !== null && cursorSeq >= headSeq) {
        await this.repairList(listId)
      }
    }
  }

  /**
   * Full re-derivation of one list from the server: resets the pull cursor
   * to 0 and re-pulls from scratch. insertRemote (seq's only writer, see
   * EventRepository) fills in the seq for every event already held locally
   * as an unconfirmed echo of our own push, and the pull's rebuild replays
   * the list's complete, correctly-ordered history. Called by reconcile
   * when it detects local/server drift a normal incremental pull can't
   * self-correct (see reconcileBatch), and exposed directly for a
   * user-triggered "re-sync from server" action - see
   * sync-design-decisions.md ("Reparatur: voller Re-Pull").
   */
  async repairList(listId: string): Promise<void> {
    const clearResult = await this.cursorRepository.clear(listId)
    if (!clearResult.success) {
      logger.error(
        `Failed to clear pull cursor for list ${listId} before repair`,
        clearResult.getError()
      )
      return
    }
    await this.pullList(listId)
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

  /**
   * The local pull cursor's seq, defaulting to 0 if the list's never been
   * pulled. Null (already logged) means a real DB error - distinct from
   * "never pulled", which callers must not treat as an unnecessary full
   * pull.
   */
  private async readCursorSeq(listId: string): Promise<number | null> {
    const cursorResult = await this.cursorRepository.get(listId)
    if (!cursorResult.success) {
      logger.error(
        `Failed to read pull cursor for list ${listId}`,
        cursorResult.getError()
      )
      return null
    }
    return cursorResult.getValue()?.last_seen_seq ?? 0
  }

  private async pullListToHead(listId: string, headSeq: number): Promise<void> {
    const cursorSeq = await this.readCursorSeq(listId)
    if (cursorSeq === null) {
      // Already logged; skip this list, the next trigger retries.
      return
    }

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
