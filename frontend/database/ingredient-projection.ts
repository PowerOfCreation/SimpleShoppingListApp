import { SQLiteDatabase } from "expo-sqlite"
import {
  DomainEventRow,
  EventTypes,
  byOccurredAtThenEventId,
} from "@/types/DomainEvent"

export class IngredientProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  async handleCreated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { name, listId, completed, completedAt } = JSON.parse(event.payload)
    // ON CONFLICT rather than a bare INSERT: a scoped projection rebuild
    // (rebuildForList) replays a list's *entire* merged local+pulled
    // history from scratch every time new remote events land, and two
    // devices can both have created the very same ingredient.created
    // event in their own local log before ever syncing - a bare INSERT
    // would throw on the second occurrence and abort the whole rebuild.
    await db.runAsync(
      `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         completed = excluded.completed,
         list_id = excluded.list_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at`,
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

  async handlePriorityCleared(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    await db.runAsync(
      `UPDATE ingredients SET priority = NULL, updated_at = ? WHERE id = ?`,
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

  /**
   * Rebuilds one list's ingredients from a fully-merged (local + pulled)
   * event history, ordered by (occurred_at, event_id) - see
   * EventRepository.getByListId for why that tiebreak, not rowid, is what
   * makes two devices converge on the same state regardless of which
   * order the events actually arrived in.
   *
   * Unlike rebuild(), this does not open its own transaction: it's always
   * called from within EventApplier's transaction, which also updates the
   * pull cursor - the projection change and "we've applied up to seq N"
   * must commit atomically, or a crash in between would leave the cursor
   * pointing past events the projection never actually replayed.
   */
  async rebuildForList(
    db: SQLiteDatabase,
    listId: string,
    events: DomainEventRow[]
  ): Promise<void> {
    await db.runAsync(`DELETE FROM ingredients WHERE list_id = ?`, listId)
    // Sorted here rather than trusted from the caller: convergence across
    // devices depends on this exact order, and defending it at the one
    // place that actually replays events is cheaper than auditing every
    // future call site.
    const ordered = [...events].sort(byOccurredAtThenEventId)
    for (const event of ordered) {
      switch (event.event_type) {
        case EventTypes.INGREDIENT_CREATED:
          await this.handleCreated(db, event)
          break
        case EventTypes.INGREDIENT_UPDATED:
          await this.handleUpdated(db, event)
          break
        case EventTypes.INGREDIENT_PRIORITY_SET:
          await this.handlePrioritySet(db, event)
          break
        case EventTypes.INGREDIENT_PRIORITY_CLEARED:
          await this.handlePriorityCleared(db, event)
          break
        case EventTypes.INGREDIENT_DELETED:
          await this.handleDeleted(db, event)
          break
      }
    }
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
          case EventTypes.INGREDIENT_PRIORITY_CLEARED:
            await this.handlePriorityCleared(this.db, event)
            break
          case EventTypes.INGREDIENT_DELETED:
            await this.handleDeleted(this.db, event)
            break
        }
      }
    })
  }
}
