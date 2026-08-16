import { SQLiteDatabase } from "expo-sqlite"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { runExclusive } from "@/database/write-lock"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"
import { createLogger } from "@/api/common/logger"
import {
  notifyListDataChanged,
  notifySyncListsChanged,
} from "@/api/sync/sync-events"

const logger = createLogger("EventApplier")

/**
 * Applies one page of pulled events atomically: insert the new event rows,
 * rebuild the affected list's projections from full merged history, and
 * advance the pull cursor - all in one transaction, so a crash partway
 * through can't leave the cursor ahead of the projection. rebuildForAck
 * handles the same reshuffle for our own acked pushes, minus the cursor.
 *
 * Doesn't extend BaseRepository: its _executeTransaction goes through
 * runExclusive itself, and nesting that here would deadlock. Every
 * collaborator called inside a transaction here therefore takes an
 * explicit `db` handle and opens no transaction of its own (insertRemote,
 * rebuildForList, setWithin) - see write-lock.ts.
 */
export class EventApplier {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly eventRepository: EventRepository,
    private readonly ingredientProjection: IngredientProjection,
    private readonly listProjection: IngredientListProjection,
    private readonly cursorRepository: SyncCursorRepository,
    private readonly listSyncSettingsRepository: ListSyncSettingsRepository
  ) {}

  /**
   * `events` is one list's page of pulled events (any order is fine - the
   * rebuild below re-sorts); `seq` is the seq to advance the list's cursor
   * to once this page is applied (normally the page's next_seq).
   */
  async apply(
    listId: string,
    events: DomainEventRow[],
    seq: number
  ): Promise<Result<{ applied: number }, DbQueryError>> {
    try {
      let applied = 0
      let listDeleted = false

      await runExclusive(() =>
        this.db.withTransactionAsync(async () => {
          for (const event of events) {
            applied += await this.eventRepository.insertRemote(event)
          }

          // A page where every event was already present is a pure echo
          // (our own push, or a re-delivered page) - nothing to rebuild,
          // just advance the cursor below.
          if (applied > 0) {
            listDeleted = await this.rebuildListProjections(listId)
          }

          await this.cursorRepository.setWithin(
            this.db,
            listId,
            seq,
            Date.now()
          )
        })
      )

      if (applied > 0) {
        notifyListDataChanged(listId)
      }
      if (listDeleted) {
        notifySyncListsChanged()
      }

      return Result.ok({ applied })
    } catch (error) {
      logger.error(`Failed to apply pulled events for list ${listId}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to apply pulled events for list ${listId}`,
          "apply",
          "EventApplier",
          error
        )
      )
    }
  }

  /**
   * Rebuilds one list's projections after one of our own pushed events got
   * its seq (see SyncEngine.handleAck) - same reshuffle as apply(), but no
   * cursor to advance and nothing new to insert.
   */
  async rebuildForAck(listId: string): Promise<Result<void, DbQueryError>> {
    try {
      let listDeleted = false
      await runExclusive(() =>
        this.db.withTransactionAsync(async () => {
          listDeleted = await this.rebuildListProjections(listId)
        })
      )
      notifyListDataChanged(listId)
      if (listDeleted) {
        notifySyncListsChanged()
      }
      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Failed to rebuild list ${listId} after ack`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to rebuild list ${listId} after ack`,
          "rebuildForAck",
          "EventApplier",
          error
        )
      )
    }
  }

  /** Returns whether this list was actually deleted (vs. just missing its `created`). */
  private async rebuildListProjections(listId: string): Promise<boolean> {
    const historyResult = await this.eventRepository.getByListId(listId)
    if (!historyResult.success) {
      throw historyResult.getError()
    }
    const history = historyResult.getValue()!

    await this.listProjection.rebuildForList(this.db, listId, history)

    // No row in ingredient_lists after a rebuild has two causes, not one:
    // the merged history ends in todo_list.deleted, or it's simply missing
    // todo_list.created (the case #230's repairList exists to fix). Either
    // way, rebuilding ingredients would re-insert rows referencing a list
    // that no longer exists in the read model - harmless on-device
    // (expo-sqlite runs without PRAGMA foreign_keys) but a hard FK
    // violation under the exclusive-FK test mock, and pointless either way
    // - just drop them instead.
    const listRow = await this.db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ingredient_lists WHERE id = ?`,
      listId
    )
    if (listRow) {
      await this.ingredientProjection.rebuildForList(this.db, listId, history)
      return false
    }

    await this.db.runAsync(`DELETE FROM ingredients WHERE list_id = ?`, listId)

    // Only drop the sync setting on an actual deletion. Dropping it just
    // because the row is missing would also fire for a repairable list
    // (no created event yet) - silently kicking it out of
    // getEnabledIds() and out of every pull/reconcile/subscribe, the same
    // catch-22 this device-local setting was introduced to fix.
    const deleted = history.some(
      (event) => event.event_type === EventTypes.TODO_LIST_DELETED
    )
    if (deleted) {
      await this.listSyncSettingsRepository.removeWithin(this.db, listId)
    }
    return deleted
  }
}
