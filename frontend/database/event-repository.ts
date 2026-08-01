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
   * sync engine pass ids already in the order they must be sent, and that
   * order matters (see the rowid tiebreak on getByAggregateId/Type above).
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
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload
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

  async getByAggregateId(
    aggregateId: string
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload
         FROM domain_events
         WHERE aggregate_id = ?
         ORDER BY occurred_at ASC, rowid ASC`,
        aggregateId
      )
    }, "getByAggregateId")
  }

  /**
   * Fetches every event for a list (its own todo_list.* history plus every
   * ingredient.* event resolved to it via list_id), ordered by
   * (occurred_at, event_id) - a total, device-independent order. This is
   * deliberately *not* the (occurred_at, rowid) tiebreak getByAggregateId
   * uses: rowid is local insertion order, which differs per device, so two
   * devices replaying the same event set in rowid order could tiebreak
   * differently and diverge. event_id (a uuid) breaks ties identically
   * everywhere. Used by the pull applier to rebuild a list's projection from
   * its full local history after merging in remote events.
   */
  async getByListId(
    listId: string
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload
         FROM domain_events
         WHERE list_id = ?
         ORDER BY occurred_at ASC, event_id ASC`,
        listId
      )
    }, "getByListId")
  }

  /**
   * Fallback for resolving list_id when the ingredient row is already gone
   * (a delete racing the read that normally supplies list_id - see
   * IngredientRepository.getListContext). Returns the most recently
   * recorded list_id for this aggregate, or null if none of its events
   * have one (e.g. the created event was itself lost).
   */
  async getLastListIdForAggregate(
    aggregateId: string
  ): Promise<Result<string | null, DbQueryError>> {
    return this._executeQuery(async () => {
      const row = await this.db.getFirstAsync<{ list_id: string | null }>(
        `SELECT list_id FROM domain_events
         WHERE aggregate_id = ? AND list_id IS NOT NULL
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT 1`,
        aggregateId
      )
      return row?.list_id ?? null
    }, "getLastListIdForAggregate")
  }

  async getAll(): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload
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
        `SELECT event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload
         FROM domain_events
         WHERE aggregate_type = ?
         ORDER BY occurred_at ASC, rowid ASC`,
        aggregateType
      )
    }, "getByAggregateType")
  }
}
