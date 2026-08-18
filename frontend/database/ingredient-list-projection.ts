import { SQLiteDatabase } from "expo-sqlite"
import {
  DomainEventRow,
  EventTypes,
  byServerSeqThenLocal,
} from "@/types/DomainEvent"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("IngredientListProjection")

type NamePayload = { name: string }

function isNamePayload(value: unknown): value is NamePayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === "string"
  )
}

export class IngredientListProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  // R4 (see frontend/docs/sync-server-registry-roadmap.md): a projection
  // must never throw on a bad event - an unparseable/malformed payload from
  // another device or client version is skipped and logged, not fatal.
  // onSkip is optional and purely additive - it lets rebuildForList tally
  // how many events it skipped without handle* methods having to change
  // their (tested) void-resolving, never-throwing return contract.
  private parsePayload<T>(
    event: DomainEventRow,
    isValid: (value: unknown) => value is T,
    onSkip?: () => void
  ): T | null {
    let value: unknown
    try {
      value = JSON.parse(event.payload)
    } catch {
      this.logSkipped(event, "payload is not valid JSON", onSkip)
      return null
    }
    if (!isValid(value)) {
      this.logSkipped(event, "payload is missing a required field", onSkip)
      return null
    }
    return value
  }

  private logSkipped(
    event: DomainEventRow,
    reason: string,
    onSkip?: () => void
  ): void {
    logger.warn("Skipping event while rebuilding list projection", {
      event_id: event.event_id,
      event_type: event.event_type,
      reason,
    })
    onSkip?.()
  }

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
    event: DomainEventRow,
    onSkip?: () => void
  ): Promise<void> {
    const payload = this.parsePayload(event, isNamePayload, onSkip)
    if (!payload) return
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      event.aggregate_id,
      payload.name,
      event.occurred_at,
      event.occurred_at
    )
  }

  async handleUpdated(
    db: SQLiteDatabase,
    event: DomainEventRow,
    onSkip?: () => void
  ): Promise<void> {
    const payload = this.parsePayload(event, isNamePayload, onSkip)
    if (!payload) return
    await db.runAsync(
      `UPDATE ingredient_lists SET name = ?, updated_at = ? WHERE id = ?`,
      payload.name,
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

    let skippedCount = 0
    for (const event of ordered) {
      if (await this.applyEvent(db, event)) {
        skippedCount++
      }
    }

    // Same diagnosability pattern as the no-todo_list.created warning above:
    // a rebuild that skipped events can't fix itself, but naming the repair
    // path here keeps this discoverable through SyncEngine.repairList - the
    // same place drift recovery already lives - instead of only a per-event
    // log line.
    if (skippedCount > 0) {
      logger.warn(
        `List ${listId} skipped ${skippedCount} unreadable event(s) during rebuild - see SyncEngine.repairList to re-derive it from the server`
      )
    }
  }

  async rebuild(events: DomainEventRow[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ingredient_lists`)
      const ordered = [...events].sort(byServerSeqThenLocal)
      for (const event of ordered) {
        await this.applyEvent(this.db, event)
      }
    })
  }

  // Belt-and-suspenders on top of parsePayload's field validation: any
  // handler that still throws (e.g. an unforeseen bad shape) must not take
  // the rest of the rebuild down with it - R4 applies to the whole dispatch,
  // not just JSON parsing. Returns whether the event was skipped, so callers
  // can tally it (see rebuildForList's aggregate warning above).
  private async applyEvent(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<boolean> {
    let skipped = false
    const onSkip = () => {
      skipped = true
    }
    try {
      switch (event.event_type) {
        case EventTypes.TODO_LIST_CREATED:
          await this.handleCreated(db, event, onSkip)
          break
        case EventTypes.TODO_LIST_UPDATED:
          await this.handleUpdated(db, event, onSkip)
          break
        case EventTypes.TODO_LIST_DELETED:
          await this.handleDeleted(db, event)
          break
      }
    } catch (error) {
      logger.warn("Skipping event that failed to apply to list projection", {
        event_id: event.event_id,
        event_type: event.event_type,
        reason: error,
      })
      skipped = true
    }
    return skipped
  }
}
