import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { EventRepository, AppendEntry } from "@/database/event-repository"
import { OutboxRepository } from "@/database/outbox-repository"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { IngredientRepository } from "@/database/ingredient-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { compactListToEvents } from "@/database/list-compaction"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import {
  EventTypes,
  AggregateTypes,
  DomainEventRow,
  SYNCABLE_EVENT_TYPES,
} from "@/types/DomainEvent"
import { getClientId } from "@/api/common/client-id"
import { notifyOutboxChanged } from "@/api/sync/outbox-events"
import { notifySyncListsChanged } from "@/api/sync/sync-events"
import { clearListSyncStatus } from "@/api/sync/list-sync-status"

const logger = createLogger("ShoppingListService")

export class ShoppingListService {
  private repository: IngredientListRepository
  private eventRepository: EventRepository
  private outboxRepository: OutboxRepository
  private projection: IngredientListProjection
  private listSyncStateRepository: ListSyncStateRepository
  private ingredientRepository: IngredientRepository
  private ingredientProjection: IngredientProjection

  constructor(
    repository?: IngredientListRepository,
    eventRepository?: EventRepository,
    projection?: IngredientListProjection,
    outboxRepository?: OutboxRepository,
    listSyncStateRepository?: ListSyncStateRepository,
    ingredientRepository?: IngredientRepository,
    ingredientProjection?: IngredientProjection
  ) {
    const db = getDatabase()
    this.repository = repository || new IngredientListRepository(db)
    this.eventRepository = eventRepository || new EventRepository(db)
    this.projection = projection || new IngredientListProjection(db)
    this.outboxRepository = outboxRepository || new OutboxRepository(db)
    this.listSyncStateRepository =
      listSyncStateRepository || new ListSyncStateRepository(db)
    this.ingredientRepository =
      ingredientRepository || new IngredientRepository(db)
    this.ingredientProjection =
      ingredientProjection || new IngredientProjection(db)
  }

  async createList(
    listName: string,
    syncEnabled: boolean = false
  ): Promise<Result<string, ValidationError | DbQueryError>> {
    if (!listName.trim()) {
      return Result.fail(
        new ValidationError("Shopping list name can't be empty", "name")
      )
    }

    try {
      const now = Date.now()
      const listId = uuidv4()
      const createdEvent: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.TODO_LIST_CREATED,
        aggregate_id: listId,
        aggregate_type: AggregateTypes.TODO_LIST,
        list_id: listId,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: listName }),
        seq: null,
      }

      const entries: AppendEntry[] = [
        {
          event: createdEvent,
          project: async (db) => {
            await this.projection.handleCreated(db, createdEvent)
            // Written in the same transaction as the create, so a crash
            // partway through can't leave the setting out of step with
            // whether the list even exists - see list-sync-state-repository.ts.
            if (syncEnabled) {
              await this.listSyncStateRepository.setEnabledWithin(
                db,
                listId,
                true
              )
            }
          },
          // Only enqueued when sync is on - creating a list without the
          // sync toggle must not send anything to the server.
          enqueueForSync: syncEnabled,
        },
      ]

      const result = await this.eventRepository.appendAll(entries)

      if (!result.success) {
        return Result.fail(result.getError())
      }

      if (syncEnabled) {
        // Nudge the sync engine to try sending this soon rather than
        // waiting for the next unrelated trigger (foreground, timer, ...).
        notifyOutboxChanged()
        // A new sync-enabled list changes the set the provider subscribes
        // to and pulls for.
        notifySyncListsChanged()
      }

      return Result.ok(listId)
    } catch (error) {
      logger.error("Error creating shopping list", error)
      return Result.fail(
        new DbQueryError(
          "Failed to create shopping list",
          "createList",
          "IngredientList",
          error
        )
      )
    }
  }

  /**
   * Duplicates a list client-side: reads the *current projection* (name +
   * ingredients) of sourceListId and writes it out as a fresh, history-free
   * event sequence for a brand-new list id - see list-compaction.ts. The
   * source's own history (past renames, deletions, completions-then-undos)
   * is never read, so none of it carries over.
   *
   * The copy is always local (no list_sync_state row, nothing enqueued) -
   * pushing it is the user's separate decision via setSyncEnabled, which
   * already replays a list's full (here: minimal) syncable history.
   */
  async duplicateList(
    sourceListId: string,
    newName: string
  ): Promise<Result<string, ValidationError | DbQueryError>> {
    if (!newName.trim()) {
      return Result.fail(
        new ValidationError("Shopping list name can't be empty", "name")
      )
    }

    try {
      const sourceResult = await this.repository.getById(sourceListId)
      if (!sourceResult.success) {
        return Result.fail(sourceResult.getError())
      }
      const source = sourceResult.getValue()
      if (!source) {
        return Result.fail(
          new DbQueryError(
            `Shopping list ${sourceListId} not found`,
            "duplicateList",
            "IngredientList"
          )
        )
      }

      const ingredientsResult =
        await this.ingredientRepository.getAll(sourceListId)
      if (!ingredientsResult.success) {
        return Result.fail(ingredientsResult.getError())
      }

      const newListId = uuidv4()
      const events = compactListToEvents(
        {
          listId: newListId,
          name: newName,
          ingredients: ingredientsResult.getValue()!,
        },
        {
          newId: uuidv4,
          ingredientIdFor: () => uuidv4(),
          occurredAt: Date.now(),
          clientId: getClientId(),
        }
      )

      const entries: AppendEntry[] = events.map((event) => ({
        event,
        project: async (db) => {
          const projection =
            event.aggregate_type === AggregateTypes.TODO_LIST
              ? this.projection
              : this.ingredientProjection
          await projection.applyEvent(db, event)
        },
      }))

      const result = await this.eventRepository.appendAll(entries)
      if (!result.success) {
        return Result.fail(result.getError())
      }

      return Result.ok(newListId)
    } catch (error) {
      logger.error(`Error duplicating shopping list ${sourceListId}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to duplicate shopping list ${sourceListId}`,
          "duplicateList",
          "IngredientList",
          error
        )
      )
    }
  }

  /**
   * Turns sync on or off for an existing list.
   *
   * The toggle itself is a device-local setting (list_sync_state), not a
   * domain event - see list-sync-state-repository.ts. The backend never
   * learns "sync was turned on/off" as its own fact; turning sync on simply
   * starts pushing the list's existing content.
   *
   * Turning it on additionally replays the *list's* existing syncable
   * history into the outbox (in stable occurred_at+insertion order) - not
   * just its own todo_list.* events but every ingredient.* event resolved
   * to this list_id too, so the server ends up with the full list, not just
   * its current name. Turning it off cancels every still-pending outbox row
   * for the list, ingredient rows included - the server's existing copy (if
   * any) is left alone; deleting it is a separate, explicit action.
   *
   * The setting write and the outbox change are two separate statements,
   * not one transaction - a crash between them is not silently wrong: if
   * enabling, the next reconcile pass finds the server still missing this
   * list's syncable history (getByListId doesn't care whether
   * enqueueExistingForSync already ran) and re-enqueues it; if disabling, at
   * worst a few already-queued rows still go out once, which turning sync
   * back on would have resent anyway.
   */
  async setSyncEnabled(
    listId: string,
    enabled: boolean
  ): Promise<Result<void, DbQueryError>> {
    try {
      const settingResult = await this.listSyncStateRepository.setEnabled(
        listId,
        enabled
      )
      if (!settingResult.success) {
        return settingResult
      }

      if (enabled) {
        const historyResult = await this.eventRepository.getByListId(listId)
        if (!historyResult.success) {
          return Result.fail(historyResult.getError())
        }
        const syncableHistory = historyResult
          .getValue()!
          .filter((event) => SYNCABLE_EVENT_TYPES.includes(event.event_type))

        const enqueueResult =
          await this.eventRepository.enqueueExistingForSync(syncableHistory)
        if (!enqueueResult.success) {
          return Result.fail(enqueueResult.getError())
        }
      } else {
        const cancelResult = await this.outboxRepository.cancelForList(listId)
        if (!cancelResult.success) {
          return Result.fail(cancelResult.getError())
        }
      }

      notifyOutboxChanged()
      notifySyncListsChanged()

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error setting sync enabled for list ${listId}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to set sync enabled for list ${listId}`,
          "setSyncEnabled",
          "IngredientList",
          error
        )
      )
    }
  }

  /**
   * Turns sync off for every list this device currently syncs - logout's
   * "stop sharing my further changes" step. Unlike setSyncEnabled(id, false)
   * (a deliberate per-list "leave it off"), this removes the
   * list_sync_state row entirely: logging out isn't a decision to stop
   * syncing these lists forever, so the next login's discovery pass
   * (SyncCoordinator.discoverLists, keyed off getKnownIds()) should treat
   * them as unseen again and re-enable whichever ones the server still
   * reports for this account.
   */
  async disableAllSync(): Promise<Result<void, DbQueryError>> {
    try {
      const idsResult = await this.listSyncStateRepository.getEnabledIds()
      if (!idsResult.success) {
        return Result.fail(idsResult.getError())
      }
      const listIds = idsResult.getValue()!

      // Best-effort per list: a failure on one list must not leave the
      // remaining ones still fully sync-enabled after logout completes.
      let firstError: DbQueryError | undefined
      for (const listId of listIds) {
        const settingResult = await this.listSyncStateRepository.remove(listId)
        if (!settingResult.success) {
          firstError ??= settingResult.getError()
          continue
        }
        clearListSyncStatus(listId)
        const cancelResult = await this.outboxRepository.cancelForList(listId)
        if (!cancelResult.success) {
          firstError ??= cancelResult.getError()
        }
      }

      if (listIds.length > 0) {
        notifyOutboxChanged()
        notifySyncListsChanged()
      }

      return firstError ? Result.fail(firstError) : Result.ok(undefined)
    } catch (error) {
      logger.error("Error disabling sync for all lists", error)
      return Result.fail(
        new DbQueryError(
          "Failed to disable sync for all lists",
          "disableAllSync",
          "IngredientList",
          error
        )
      )
    }
  }

  async updateName(
    listId: string,
    newName: string
  ): Promise<Result<void, ValidationError | DbQueryError>> {
    if (!newName.trim()) {
      return Result.fail(
        new ValidationError("Shopping list name can't be empty", "name")
      )
    }

    try {
      const now = Date.now()
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.TODO_LIST_UPDATED,
        aggregate_id: listId,
        aggregate_type: AggregateTypes.TODO_LIST,
        list_id: listId,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: newName }),
        seq: null,
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleUpdated(db, event)
      )

      if (!result.success) {
        return Result.fail(result.getError())
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.error("Error updating shopping list name", error)
      return Result.fail(
        new DbQueryError(
          "Failed to update shopping list name",
          "updateName",
          "IngredientList",
          error
        )
      )
    }
  }

  async getAllWithCounts(): Promise<
    Result<ShoppingListOverview[], DbQueryError>
  > {
    try {
      const result = await this.repository.getAllWithCounts()

      if (!result.success) {
        const error = result.getError()
        logger.error("Error fetching shopping lists with counts", error)
        return Result.fail(error)
      }

      return Result.ok(result.getValue()!)
    } catch (error) {
      logger.error("Error fetching shopping lists with counts", error)
      return Result.fail(
        new DbQueryError(
          "Failed to fetch shopping lists",
          "getAllWithCounts",
          "IngredientList",
          error
        )
      )
    }
  }

  async deleteList(listId: string): Promise<Result<void, DbQueryError>> {
    try {
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.TODO_LIST_DELETED,
        aggregate_id: listId,
        aggregate_type: AggregateTypes.TODO_LIST,
        list_id: listId,
        occurred_at: Date.now(),
        client_id: getClientId(),
        payload: JSON.stringify({}),
        seq: null,
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        async (db) => {
          await this.projection.handleDeleted(db, event)
          await this.listSyncStateRepository.removeWithin(db, listId)
        }
      )

      if (!result.success) {
        return Result.fail(result.getError())
      }

      clearListSyncStatus(listId)
      notifySyncListsChanged()

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error deleting shopping list ${listId}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to delete shopping list ${listId}`,
          "deleteList",
          "IngredientList",
          error
        )
      )
    }
  }

  async rebuildProjection(): Promise<Result<void, DbQueryError>> {
    const eventsResult = await this.eventRepository.getByAggregateType(
      AggregateTypes.TODO_LIST
    )
    if (!eventsResult.success) {
      return Result.fail(eventsResult.getError())
    }
    try {
      await this.projection.rebuild(eventsResult.getValue()!)
      return Result.ok(undefined)
    } catch (error) {
      logger.error("Error rebuilding projection", error)
      return Result.fail(
        new DbQueryError(
          "Failed to rebuild projection",
          "rebuildProjection",
          "IngredientList",
          error
        )
      )
    }
  }
}

let instance: ShoppingListService | null = null

// Lazy, not `export const ... = new ShoppingListService()`: that would call
// getDatabase() at module-evaluation time, before app/_layout.tsx has had a
// chance to run ensureDatabaseInitialized() - fatal on web, where the DB
// can only be opened asynchronously.
export function getShoppingListService(): ShoppingListService {
  if (!instance) {
    instance = new ShoppingListService()
  }
  return instance
}
