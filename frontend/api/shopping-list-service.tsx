import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { EventRepository, AppendEntry } from "@/database/event-repository"
import { OutboxRepository } from "@/database/outbox-repository"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
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

const logger = createLogger("ShoppingListService")

export class ShoppingListService {
  private repository: IngredientListRepository
  private eventRepository: EventRepository
  private outboxRepository: OutboxRepository
  private projection: IngredientListProjection

  constructor(
    repository?: IngredientListRepository,
    eventRepository?: EventRepository,
    projection?: IngredientListProjection,
    outboxRepository?: OutboxRepository
  ) {
    const db = getDatabase()
    this.repository = repository || new IngredientListRepository(db)
    this.eventRepository = eventRepository || new EventRepository(db)
    this.projection = projection || new IngredientListProjection(db)
    this.outboxRepository = outboxRepository || new OutboxRepository(db)
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
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: listName }),
      }

      const entries: AppendEntry[] = [
        {
          event: createdEvent,
          project: (db) => this.projection.handleCreated(db, createdEvent),
          // Only enqueued when sync is on - creating a list without the
          // sync toggle must not send anything to the server.
          enqueueForSync: syncEnabled,
        },
      ]

      if (syncEnabled) {
        const syncEnabledEvent: DomainEventRow = {
          event_id: uuidv4(),
          event_type: EventTypes.TODO_LIST_SYNC_ENABLED,
          aggregate_id: listId,
          aggregate_type: AggregateTypes.TODO_LIST,
          occurred_at: now,
          client_id: getClientId(),
          payload: JSON.stringify({}),
        }
        entries.push({
          event: syncEnabledEvent,
          project: (db) =>
            this.projection.handleSyncEnabled(db, syncEnabledEvent),
          // sync_enabled/disabled are a local decision - never sent to the
          // backend, which has no notion of them (see SYNCABLE_EVENT_TYPES).
        })
      }

      const result = await this.eventRepository.appendAll(entries)

      if (!result.success) {
        return Result.fail(result.getError())
      }

      if (syncEnabled) {
        // Nudge the sync engine to try sending this soon rather than
        // waiting for the next unrelated trigger (foreground, timer, ...).
        notifyOutboxChanged()
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
   * Turns sync on or off for an existing list.
   *
   * Turning it on replays the aggregate's existing todo_list.* history into
   * the outbox (in stable occurred_at+insertion order) so the server ends
   * up with the list's full history, not just its current name. Turning it
   * off only cancels still-pending outbox rows - the server's existing copy
   * (if any) is left alone; deleting it is a separate, explicit action.
   */
  async setSyncEnabled(
    listId: string,
    enabled: boolean
  ): Promise<Result<void, DbQueryError>> {
    try {
      const now = Date.now()
      const syncEvent: DomainEventRow = {
        event_id: uuidv4(),
        event_type: enabled
          ? EventTypes.TODO_LIST_SYNC_ENABLED
          : EventTypes.TODO_LIST_SYNC_DISABLED,
        aggregate_id: listId,
        aggregate_type: AggregateTypes.TODO_LIST,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({}),
      }

      const appendResult = await this.eventRepository.appendAll([
        {
          event: syncEvent,
          project: (db) =>
            enabled
              ? this.projection.handleSyncEnabled(db, syncEvent)
              : this.projection.handleSyncDisabled(db, syncEvent),
        },
      ])
      if (!appendResult.success) {
        return Result.fail(appendResult.getError())
      }

      if (enabled) {
        const historyResult =
          await this.eventRepository.getByAggregateId(listId)
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

        notifyOutboxChanged()
      } else {
        const cancelResult =
          await this.outboxRepository.cancelForAggregate(listId)
        if (!cancelResult.success) {
          return Result.fail(cancelResult.getError())
        }
      }

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
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: newName }),
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
        occurred_at: Date.now(),
        client_id: getClientId(),
        payload: JSON.stringify({}),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleDeleted(db, event)
      )

      if (!result.success) {
        return Result.fail(result.getError())
      }

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

export const shoppingListService = new ShoppingListService()
