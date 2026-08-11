import { SQLiteDatabase } from "expo-sqlite"
import {
  DomainEventRow,
  EventTypes,
  byServerSeqThenLocal,
} from "@/types/DomainEvent"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("IngredientListProjection")

export class IngredientListProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Upsert rather than a plain INSERT: rebuildForList/rebuild always DELETE
   * the row first, so a conflict here means the merged history handed to
   * this rebuild was itself unexpected (e.g. a duplicate/echoed created
   * event). A plain INSERT would throw and roll back the whole rebuild
   * transaction, leaving the projection in whatever stale state it was in
   * before - a worse failure mode than just applying the latest values.
   */
  async handleCreated(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<void> {
    const { name } = JSON.parse(event.payload)
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
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

    // A list with any history at all but no todo_list.created among it is
    // unexpected (a create is always the first event for a list) and would
    // otherwise fail silently: every other handler is an UPDATE/DELETE that
    // no-ops when the row doesn't exist, so the list would just stay
    // invisible with no error anywhere. Surfacing it here doesn't fix the
    // gap - a fresh pull for this list (see SyncEngine.repairList) is what
    // can - but at least makes it diagnosable instead of silent.
    if (
      ordered.length > 0 &&
      !ordered.some(
        (event) => event.event_type === EventTypes.TODO_LIST_CREATED
      )
    ) {
      logger.warn(
        `List ${listId} has ${ordered.length} event(s) but no todo_list.created among them - the list will not appear until a repair pull recovers it`
      )
    }

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
