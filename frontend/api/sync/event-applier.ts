import { SQLiteDatabase } from "expo-sqlite"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { runExclusive } from "@/database/write-lock"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { DomainEventRow } from "@/types/DomainEvent"
import { createLogger } from "@/api/common/logger"
import { notifyListDataChanged } from "@/api/sync/sync-events"

const logger = createLogger("EventApplier")

/**
 * Applies one page of pulled events to local state, atomically: insert the
 * new event rows, rebuild the affected list's projection from its full
 * merged history, and advance the pull cursor - all in a single
 * transaction, so a crash partway through can never leave the cursor
 * ahead of what the projection actually reflects. Also handles the ack
 * side of the same problem (rebuildForAck): our own pushed event getting a
 * seq can reshuffle replay order too, just without a cursor to advance.
 *
 * This intentionally does not extend BaseRepository: it orchestrates
 * several collaborators (event log, two projections, the cursor) around
 * hand-managed transactions rather than owning a single table, and
 * BaseRepository's _executeTransaction goes through runExclusive itself -
 * nesting that here would deadlock (the inner call would wait on the
 * queue slot the outer call is still occupying). Every collaborator method
 * called from inside a transaction here is therefore one that takes an
 * explicit `db` handle and opens no transaction of its own (insertRemote,
 * rebuildForList, setWithin) - see write-lock.ts.
 */
export class EventApplier {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly eventRepository: EventRepository,
    private readonly ingredientProjection: IngredientProjection,
    private readonly listProjection: IngredientListProjection,
    private readonly cursorRepository: SyncCursorRepository
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

      await runExclusive(() =>
        this.db.withTransactionAsync(async () => {
          for (const event of events) {
            applied += await this.eventRepository.insertRemote(event)
          }

          // A page where every event was already present is a pure echo
          // (our own push, or a re-delivered page) - nothing to rebuild,
          // just advance the cursor below.
          if (applied > 0) {
            await this.rebuildListProjections(listId)
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
   * its server seq (see SyncEngine.handleAck) - that event just moved from
   * the unconfirmed tail into the confirmed order, which can reshuffle
   * replay order the same way a pull would. Unlike apply(), there's no
   * cursor to advance and no new rows to insert; the event was already
   * here.
   */
  async rebuildForAck(listId: string): Promise<Result<void, DbQueryError>> {
    try {
      await runExclusive(() =>
        this.db.withTransactionAsync(() => this.rebuildListProjections(listId))
      )
      notifyListDataChanged(listId)
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

  private async rebuildListProjections(listId: string): Promise<void> {
    const historyResult = await this.eventRepository.getByListId(listId)
    if (!historyResult.success) {
      throw historyResult.getError()
    }
    const history = historyResult.getValue()!

    await this.listProjection.rebuildForList(this.db, listId, history)

    // If the merged history's last word for this list is todo_list.deleted,
    // the list projection just deleted the row - rebuilding ingredients
    // would re-insert rows referencing a list that no longer exists in the
    // read model. Harmless on-device (expo-sqlite runs without PRAGMA
    // foreign_keys) but a hard FK violation under the exclusive-FK test
    // mock, and pointless either way - just drop them instead.
    const listRow = await this.db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ingredient_lists WHERE id = ?`,
      listId
    )
    if (listRow) {
      await this.ingredientProjection.rebuildForList(this.db, listId, history)
    } else {
      await this.db.runAsync(
        `DELETE FROM ingredients WHERE list_id = ?`,
        listId
      )
    }
  }
}
