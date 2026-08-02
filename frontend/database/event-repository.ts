import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { OutboxRepository } from "./outbox-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { DomainEventRow } from "@/types/DomainEvent"

export type AppendEntry = {
  event: DomainEventRow
  /** Runs in the same transaction as the event insert. */
  project?: (db: SQLiteDatabase) => Promise<void>
  /**
   * Enqueues this event into the outbox in the same transaction, so a crash
   * between the event insert and the outbox insert can never happen.
   */
  enqueueForSync?: boolean
}

export class EventRepository extends BaseRepository {
  protected readonly entityName = "DomainEvent"
  private readonly outboxRepository: OutboxRepository

  constructor(db: SQLiteDatabase, outboxRepository?: OutboxRepository) {
    super(db, "EventRepository")
    this.outboxRepository = outboxRepository ?? new OutboxRepository(db)
  }

  async append(event: DomainEventRow): Promise<Result<void, DbQueryError>> {
    return this.appendAll([{ event }])
  }

  async appendWithProjection(
    event: DomainEventRow,
    projection: (db: SQLiteDatabase) => Promise<void>
  ): Promise<Result<void, DbQueryError>> {
    return this.appendAll([{ event, project: projection }])
  }

  /**
   * Inserts every event, runs its projection (if any), and enqueues it for
   * sync (if requested) - all in a single transaction. This is what lets
   * "create a list, mark it sync-enabled, and queue it for sync" commit or
   * roll back atomically instead of leaving the outbox out of step with the
   * event log if the process dies partway through.
   */
  async appendAll(entries: AppendEntry[]): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      for (const { event, project, enqueueForSync } of entries) {
        await this.db.runAsync(
          `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          event.event_id,
          event.event_type,
          event.aggregate_id,
          event.aggregate_type,
          event.list_id,
          event.occurred_at,
          event.client_id,
          event.payload
        )

        if (project) {
          await project(this.db)
        }

        if (enqueueForSync) {
          await this.outboxRepository.enqueue(
            this.db,
            event.event_id,
            event.aggregate_id,
            event.occurred_at
          )
        }
      }
    }, "appendAll")
  }

  /**
   * Enqueues already-persisted events for sync without re-inserting them
   * into domain_events. Used when sync is turned on for a list after
   * creation: the aggregate's existing todo_list.* history needs to reach
   * the server, but those event rows are already in the log - only the
   * outbox needs new rows.
   */
  async enqueueExistingForSync(
    events: DomainEventRow[]
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      for (const event of events) {
        await this.outboxRepository.enqueue(
          this.db,
          event.event_id,
          event.aggregate_id,
          event.occurred_at
        )
      }
    }, "enqueueExistingForSync")
  }

  /**
   * Fetches the full event rows for the given ids, preserving the order of
   * `eventIds` (not SQL's arbitrary IN-clause order) - callers such as the
   * sync engine pass ids already in the order they must be sent.
   */
  async getByEventIds(
    eventIds: string[]
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    if (eventIds.length === 0) {
      return Result.ok([])
    }
    return this._executeQuery(async () => {
      const placeholders = eventIds.map(() => "?").join(", ")
      const rows = await this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload, seq
         FROM domain_events
         WHERE event_id IN (${placeholders})`,
        ...eventIds
      )
      const byId = new Map(rows.map((row) => [row.event_id, row]))
      return eventIds
        .map((id) => byId.get(id))
        .filter((row): row is DomainEventRow => Boolean(row))
    }, "getByEventIds")
  }

  /**
   * Fetches every event for a list (its own todo_list.* history plus every
   * ingredient.* event resolved to it via list_id), ordered by server seq
   * with our own unconfirmed writes (seq IS NULL) trailing in local
   * insertion order - see byServerSeqThenLocal for why. Used by the pull
   * applier to rebuild a list's projection from its full local history
   * after merging in remote events.
   */
  async getByListId(
    listId: string
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload, seq
         FROM domain_events
         WHERE list_id = ?
         ORDER BY (seq IS NULL) ASC, seq ASC, rowid ASC`,
        listId
      )
    }, "getByListId")
  }

  /**
   * Inserts one pulled event, or - if we already have it as our own
   * unconfirmed write (an echo of our own push) - just fills in the seq it
   * was missing, without running any projection and without touching the
   * outbox: the applier (event-applier.ts) rebuilds the affected list's
   * projection separately from the full merged history, and a pulled event
   * must never be re-sent as if it were a local write.
   *
   * Returns the number of rows actually changed (0 for an event we already
   * had *with* a seq - a duplicate delivery of the same pull page), so a
   * caller can tell "nothing new" from "something changed" without a
   * second query. A seq getting filled in counts as a change: that event
   * just moved from the unconfirmed tail into the confirmed order, which
   * can shift replay order and needs a rebuild.
   *
   * Takes no transaction of its own - call this from within an
   * already-open transaction (see appendRemote below, or EventApplier,
   * which needs several such inserts plus a projection rebuild and a
   * cursor advance to commit together).
   */
  async insertRemote(event: DomainEventRow): Promise<number> {
    const result = await this.db.runAsync(
      `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET seq = excluded.seq WHERE domain_events.seq IS NULL`,
      event.event_id,
      event.event_type,
      event.aggregate_id,
      event.aggregate_type,
      event.list_id,
      event.occurred_at,
      event.client_id,
      event.payload,
      event.seq
    )
    return result.changes
  }

  /**
   * Records the seq the server assigned an event we pushed, once its ack
   * arrives - the event moves from the unconfirmed tail into the confirmed
   * order at that point (see byServerSeqThenLocal). A no-op if the event
   * already has a seq (a resent ack).
   */
  async markSeq(
    eventId: string,
    seq: number
  ): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE domain_events SET seq = ? WHERE event_id = ? AND seq IS NULL`,
        seq,
        eventId
      )
    }, "markSeq")
  }

  /**
   * Standalone batch version of insertRemote, wrapped in its own
   * transaction - for callers that only need "get these events into the
   * log" without the projection rebuild + cursor bookkeeping EventApplier
   * layers on top (e.g. tests, or a future backfill tool).
   */
  async appendRemote(
    events: DomainEventRow[]
  ): Promise<Result<{ applied: number }, DbQueryError>> {
    let applied = 0
    const result = await this._executeTransaction(async () => {
      for (const event of events) {
        applied += await this.insertRemote(event)
      }
    }, "appendRemote")

    if (!result.success) {
      return Result.fail(result.getError())
    }
    return Result.ok({ applied })
  }

  async getAll(): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload, seq
         FROM domain_events
         ORDER BY occurred_at DESC`
      )
    }, "getAll")
  }

  async getByAggregateType(
    aggregateType: string
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload, seq
         FROM domain_events
         WHERE aggregate_type = ?
         ORDER BY (seq IS NULL) ASC, seq ASC, rowid ASC`,
        aggregateType
      )
    }, "getByAggregateType")
  }
}
