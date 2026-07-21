import { SQLiteDatabase } from "expo-sqlite"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"

export class IngredientProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  async handleCreated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { name, listId, completed, completedAt } = JSON.parse(event.payload)
    await db.runAsync(
      `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.aggregate_id,
      name,
      completed ? 1 : 0,
      listId,
      event.occurred_at,
      event.occurred_at,
      completedAt ?? null
    )
  }

  async handleUpdated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const payload = JSON.parse(event.payload)
    if ("name" in payload) {
      await db.runAsync(
        `UPDATE ingredients SET name = ?, updated_at = ? WHERE id = ?`,
        payload.name,
        event.occurred_at,
        event.aggregate_id
      )
    } else {
      await db.runAsync(
        `UPDATE ingredients SET completed = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
        payload.completed ? 1 : 0,
        event.occurred_at,
        payload.completedAt ?? null,
        event.aggregate_id
      )
    }
  }

  async handlePrioritySet(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { priority } = JSON.parse(event.payload)
    await db.runAsync(
      `UPDATE ingredients SET priority = ?, updated_at = ? WHERE id = ?`,
      priority,
      event.occurred_at,
      event.aggregate_id
    )
  }

  async handleDeleted(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    await db.runAsync(
      `DELETE FROM ingredients WHERE id = ?`,
      event.aggregate_id
    )
  }

  async rebuild(events: DomainEventRow[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ingredients`)
      for (const event of events) {
        switch (event.event_type) {
          case EventTypes.INGREDIENT_CREATED:
            await this.handleCreated(this.db, event)
            break
          case EventTypes.INGREDIENT_UPDATED:
            await this.handleUpdated(this.db, event)
            break
          case EventTypes.INGREDIENT_PRIORITY_SET:
            await this.handlePrioritySet(this.db, event)
            break
          case EventTypes.INGREDIENT_DELETED:
            await this.handleDeleted(this.db, event)
            break
        }
      }
    })
  }
}
