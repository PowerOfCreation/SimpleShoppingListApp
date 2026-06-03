import { SQLiteDatabase } from "expo-sqlite"
import { BaseRepository } from "./base-repository"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { DomainEventRow } from "@/types/DomainEvent"

export class EventRepository extends BaseRepository {
  protected readonly entityName = "DomainEvent"

  constructor(db: SQLiteDatabase) {
    super(db, "EventRepository")
  }

  async append(event: DomainEventRow): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, occurred_at, client_id, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.event_id,
        event.event_type,
        event.aggregate_id,
        event.aggregate_type,
        event.occurred_at,
        event.client_id,
        event.payload
      )
    }, "append")
  }

  async getByAggregateId(
    aggregateId: string
  ): Promise<Result<DomainEventRow[], DbQueryError>> {
    return this._executeQuery(async () => {
      return this.db.getAllAsync<DomainEventRow>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type, occurred_at, client_id, payload
         FROM domain_events
         WHERE aggregate_id = ?
         ORDER BY occurred_at ASC`,
        aggregateId
      )
    }, "getByAggregateId")
  }
}
