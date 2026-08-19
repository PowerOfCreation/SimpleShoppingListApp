import { SQLiteDatabase } from "expo-sqlite"
import {
  DomainEventRow,
  EventTypes,
  byServerSeqThenLocal,
} from "@/types/DomainEvent"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("IngredientProjection")

type CreatedPayload = {
  name: string
  completed?: boolean
  completedAt?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCreatedPayload(value: unknown): value is CreatedPayload {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.completed === undefined || typeof value.completed === "boolean") &&
    (value.completedAt === undefined ||
      value.completedAt === null ||
      typeof value.completedAt === "number")
  )
}

function isPrioritySetPayload(value: unknown): value is { priority: number } {
  return isRecord(value) && typeof value.priority === "number"
}

export class IngredientProjection {
  constructor(private readonly db: SQLiteDatabase) {}

  // R4 (see frontend/docs/sync-sharing-target.md §6): a projection
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
    logger.warn("Skipping event while rebuilding ingredient projection", {
      event_id: event.event_id,
      event_type: event.event_type,
      reason,
    })
    onSkip?.()
  }

  async handleCreated(
    db: SQLiteDatabase,
    event: DomainEventRow,
    onSkip?: () => void
  ): Promise<void> {
    const payload = this.parsePayload(event, isCreatedPayload, onSkip)
    if (!payload) return
    // list_id comes from the envelope, not the payload: authorization is
    // enforced server-side on the envelope's list_id, so trusting a
    // payload-carried listId would let a member of list Y push an event
    // that's authorized for Y but lands in list X locally (see
    // sync-sharing-target.md §6, R2).
    if (event.list_id === null) {
      this.logSkipped(event, "event has no list_id on its envelope", onSkip)
      return
    }
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
      payload.name,
      payload.completed ? 1 : 0,
      event.list_id,
      event.occurred_at,
      event.occurred_at,
      payload.completedAt ?? null
    )
  }

  async handleUpdated(
    db: SQLiteDatabase,
    event: DomainEventRow,
    onSkip?: () => void
  ): Promise<void> {
    const payload = this.parsePayload(event, isRecord, onSkip)
    if (!payload) return
    if ("name" in payload) {
      if (typeof payload.name !== "string") {
        this.logSkipped(event, "payload.name is not a string", onSkip)
        return
      }
      await db.runAsync(
        `UPDATE ingredients SET name = ?, updated_at = ? WHERE id = ?`,
        payload.name,
        event.occurred_at,
        event.aggregate_id
      )
    } else {
      if (
        typeof payload.completed !== "boolean" ||
        (payload.completedAt !== null &&
          typeof payload.completedAt !== "number")
      ) {
        this.logSkipped(
          event,
          "payload.completed/completedAt has the wrong type",
          onSkip
        )
        return
      }
      await db.runAsync(
        `UPDATE ingredients SET completed = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
        payload.completed ? 1 : 0,
        event.occurred_at,
        payload.completedAt,
        event.aggregate_id
      )
    }
  }

  async handlePrioritySet(
    db: SQLiteDatabase,
    event: DomainEventRow,
    onSkip?: () => void
  ): Promise<void> {
    const payload = this.parsePayload(event, isPrioritySetPayload, onSkip)
    if (!payload) return
    await db.runAsync(
      `UPDATE ingredients SET priority = ?, updated_at = ? WHERE id = ?`,
      payload.priority,
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
   * event history, ordered by byServerSeqThenLocal - see that function for
   * why the server's seq, not occurred_at, is what makes two devices
   * converge on the same state regardless of arrival order.
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
    const ordered = [...events].sort(byServerSeqThenLocal)
    let skippedCount = 0
    for (const event of ordered) {
      if (await this.applyEvent(db, event)) {
        skippedCount++
      }
    }

    // Same diagnosability pattern as
    // IngredientListProjection.rebuildForList's aggregate warning: naming
    // the repair path here keeps this discoverable through
    // SyncEngine.repairList - the same place drift recovery already lives -
    // instead of only a per-event log line.
    if (skippedCount > 0) {
      logger.warn(
        `List ${listId} skipped ${skippedCount} unreadable event(s) during rebuild - see SyncEngine.repairList to re-derive it from the server`
      )
    }
  }

  async rebuild(events: DomainEventRow[]): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ingredients`)
      const ordered = [...events].sort(byServerSeqThenLocal)
      for (const event of ordered) {
        await this.applyEvent(this.db, event)
      }
    })
  }

  // R4 only covers content we can't read - parsePayload already skips that.
  // db.runAsync is the one remaining throw source here, and that's a write
  // failure (locked/full/aborted/constraint), not a bad payload: it must
  // propagate so EventApplier.apply's transaction rolls back and the cursor
  // doesn't advance past events that never actually applied.
  private async applyEvent(
    db: SQLiteDatabase,
    event: DomainEventRow
  ): Promise<boolean> {
    let skipped = false
    const onSkip = () => {
      skipped = true
    }
    switch (event.event_type) {
      case EventTypes.INGREDIENT_CREATED:
        await this.handleCreated(db, event, onSkip)
        break
      case EventTypes.INGREDIENT_UPDATED:
        await this.handleUpdated(db, event, onSkip)
        break
      case EventTypes.INGREDIENT_PRIORITY_SET:
        await this.handlePrioritySet(db, event, onSkip)
        break
      case EventTypes.INGREDIENT_PRIORITY_CLEARED:
        await this.handlePriorityCleared(db, event)
        break
      case EventTypes.INGREDIENT_DELETED:
        await this.handleDeleted(db, event)
        break
    }
    return skipped
  }
}
