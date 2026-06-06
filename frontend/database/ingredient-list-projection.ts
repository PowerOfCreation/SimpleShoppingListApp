import { SQLiteDatabase } from "expo-sqlite"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"

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

  async rebuild(events: DomainEventRow[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ingredient_lists`)
      for (const event of events) {
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
