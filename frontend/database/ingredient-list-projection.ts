import { SQLiteDatabase } from "expo-sqlite"
import {
  DomainEventRow,
  EventTypes,
  byServerSeqThenLocal,
} from "@/types/DomainEvent"

export class IngredientListProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  async handleCreated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { name } = JSON.parse(event.payload)
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      event.aggregate_id,
      name,
      event.occurred_at,
      event.occurred_at
    )
  }

  async handleUpdated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { name } = JSON.parse(event.payload)
    await db.runAsync(
      `UPDATE ingredient_lists SET name = ?, updated_at = ? WHERE id = ?`,
      name,
      event.occurred_at,
      event.aggregate_id
    )
  }

  async handleDeleted(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    await db.runAsync(
      `DELETE FROM ingredient_lists WHERE id = ?`,
      event.aggregate_id
    )
  }

  /**
   * List-scoped counterpart to rebuild(), used by EventApplier so a pull's
   * projection update and cursor advance commit in one transaction - see
   * IngredientProjection.rebuildForList for the fuller rationale (same
   * pattern, same reason).
   */
  async rebuildForList(
    db: SQLiteDatabase,
    listId: string,
    events: DomainEventRow[]
  ): Promise<void> {
    await db.runAsync(`DELETE FROM ingredient_lists WHERE id = ?`, listId)
    // See IngredientProjection.rebuildForList's comment on this sort - the
    // same "don't trust the caller got the order right" reasoning applies.
    const ordered = [...events].sort(byServerSeqThenLocal)
    for (const event of ordered) {
      switch (event.event_type) {
        case EventTypes.TODO_LIST_CREATED:
          await this.handleCreated(db, event)
          break
        case EventTypes.TODO_LIST_UPDATED:
          await this.handleUpdated(db, event)
          break
        case EventTypes.TODO_LIST_DELETED:
          await this.handleDeleted(db, event)
          break
      }
    }
  }

  async rebuild(events: DomainEventRow[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ingredient_lists`)
      const ordered = [...events].sort(byServerSeqThenLocal)
      for (const event of ordered) {
        switch (event.event_type) {
          case EventTypes.TODO_LIST_CREATED:
            await this.handleCreated(this.db, event)
            break
          case EventTypes.TODO_LIST_UPDATED:
            await this.handleUpdated(this.db, event)
            break
          case EventTypes.TODO_LIST_DELETED:
            await this.handleDeleted(this.db, event)
            break
        }
      }
    })
  }
}
