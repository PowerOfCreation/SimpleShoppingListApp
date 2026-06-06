import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { EventRepository } from "@/database/event-repository"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import { EventTypes, AggregateTypes, DomainEventRow } from "@/types/DomainEvent"
import { getClientId } from "@/api/common/client-id"

const logger = createLogger("ShoppingListService")

export class ShoppingListService {
  private repository: IngredientListRepository
  private eventRepository: EventRepository
  private projection: IngredientListProjection

  constructor(
    repository?: IngredientListRepository,
    eventRepository?: EventRepository,
    projection?: IngredientListProjection
  ) {
    const db = getDatabase()
    this.repository = repository || new IngredientListRepository(db)
    this.eventRepository = eventRepository || new EventRepository(db)
    this.projection = projection || new IngredientListProjection(db)
  }

  async createList(
    listName: string
  ): Promise<Result<string, ValidationError | DbQueryError>> {
    if (!listName.trim()) {
      return Result.fail(
        new ValidationError("Shopping list name can't be empty", "name")
      )
    }

    try {
      const now = Date.now()
      const listId = uuidv4()
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.TODO_LIST_CREATED,
        aggregate_id: listId,
        aggregate_type: AggregateTypes.TODO_LIST,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: listName }),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleCreated(db, event)
      )

      if (!result.success) {
        return Result.fail(result.getError())
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
