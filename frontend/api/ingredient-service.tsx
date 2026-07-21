import { Ingredient } from "@/types/Ingredient"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientRepository } from "@/database/ingredient-repository"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import { EventTypes, AggregateTypes, DomainEventRow } from "@/types/DomainEvent"
import { getClientId } from "@/api/common/client-id"
import { Priority } from "@/types/Priority"

const logger = createLogger("IngredientService")

export class IngredientService {
  ingredients: Ingredient[] = []
  initialLoad = true
  private repository: IngredientRepository
  private eventRepository: EventRepository
  private projection: IngredientProjection

  constructor(
    repository?: IngredientRepository,
    eventRepository?: EventRepository,
    projection?: IngredientProjection
  ) {
    const db = getDatabase()
    this.repository = repository || new IngredientRepository(db)
    this.eventRepository = eventRepository || new EventRepository(db)
    this.projection = projection || new IngredientProjection(db)
  }

  async GetIngredients(
    listId: string
  ): Promise<Result<Ingredient[], DbQueryError>> {
    try {
      const result = await this.repository.getAll(listId)

      if (!result.success) {
        logger.error("Error fetching ingredients", result.getError())
        return result
      }

      this.ingredients = result.getValue()!
      return Result.ok([...this.ingredients])
    } catch (error) {
      logger.error("Error fetching ingredients", error)
      return Result.fail(
        new DbQueryError(
          "Failed to get ingredients",
          "GetIngredients",
          "Ingredient",
          error
        )
      )
    }
  }

  async AddIngredients(
    ingredientName: string,
    listId: string
  ): Promise<Result<Ingredient, ValidationError | DbQueryError>> {
    if (!ingredientName.trim()) {
      const error = new ValidationError(
        "Ingredient name can't be empty",
        "name"
      )
      return Result.fail(error)
    }

    try {
      const now = Date.now()
      const ingredientId = uuidv4()
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.INGREDIENT_CREATED,
        aggregate_id: ingredientId,
        aggregate_type: AggregateTypes.INGREDIENT,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name: ingredientName, listId }),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleCreated(db, event)
      )

      if (!result.success) {
        logger.error("Error adding ingredient", result.getError())
        return Result.fail(result.getError())
      }

      const newIngredient: Ingredient = {
        name: ingredientName,
        completed: false,
        list_id: listId,
        id: ingredientId,
        created_at: now,
        updated_at: now,
      }
      this.ingredients.unshift(newIngredient)

      return Result.ok(newIngredient)
    } catch (error) {
      logger.error("Error adding ingredient", error)
      return Result.fail(
        new DbQueryError(
          "Failed to add ingredient",
          "AddIngredients",
          "Ingredient",
          error
        )
      )
    }
  }

  async updateCompletion(
    id: string,
    completed: boolean
  ): Promise<Result<void, DbQueryError>> {
    try {
      const now = Date.now()
      const completedAt = completed ? now : null
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.INGREDIENT_UPDATED,
        aggregate_id: id,
        aggregate_type: AggregateTypes.INGREDIENT,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ completed, completedAt }),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleUpdated(db, event)
      )

      if (!result.success) {
        logger.error(
          `Error updating completion for ingredient ${id}`,
          result.getError()
        )
        return result
      }

      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].completed = completed
        this.ingredients[index].updated_at = now
        this.ingredients[index].completed_at = completed ? now : undefined
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error updating completion for ingredient ${id}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to update completion for ingredient ${id}`,
          "updateCompletion",
          "Ingredient",
          error
        )
      )
    }
  }

  async updateName(
    id: string,
    name: string
  ): Promise<Result<void, ValidationError | DbQueryError>> {
    if (!name.trim()) {
      const error = new ValidationError(
        "Ingredient name can't be empty",
        "name"
      )
      return Result.fail(error)
    }

    try {
      const now = Date.now()
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.INGREDIENT_UPDATED,
        aggregate_id: id,
        aggregate_type: AggregateTypes.INGREDIENT,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ name }),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleUpdated(db, event)
      )

      if (!result.success) {
        logger.error(
          `Error updating name for ingredient ${id}`,
          result.getError()
        )
        return result
      }

      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].name = name
        this.ingredients[index].updated_at = now
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error updating name for ingredient ${id}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to update name for ingredient ${id}`,
          "updateName",
          "Ingredient",
          error
        )
      )
    }
  }

  async setPriority(
    id: string,
    priority: Priority
  ): Promise<Result<void, ValidationError | DbQueryError>> {
    if (!Object.values(Priority).includes(priority)) {
      const error = new ValidationError("Invalid priority", "priority")
      return Result.fail(error)
    }

    try {
      const now = Date.now()
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.INGREDIENT_PRIORITY_SET,
        aggregate_id: id,
        aggregate_type: AggregateTypes.INGREDIENT,
        occurred_at: now,
        client_id: getClientId(),
        payload: JSON.stringify({ priority }),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handlePrioritySet(db, event)
      )

      if (!result.success) {
        logger.error(
          `Error updating priority for ingredient ${id}`,
          result.getError()
        )
        return result
      }

      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].priority = priority
        this.ingredients[index].updated_at = now
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error updating priority for ingredient ${id}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to update priority for ingredient ${id}`,
          "setPriority",
          "Ingredient",
          error
        )
      )
    }
  }

  async deleteIngredient(id: string): Promise<Result<void, DbQueryError>> {
    try {
      const event: DomainEventRow = {
        event_id: uuidv4(),
        event_type: EventTypes.INGREDIENT_DELETED,
        aggregate_id: id,
        aggregate_type: AggregateTypes.INGREDIENT,
        occurred_at: Date.now(),
        client_id: getClientId(),
        payload: JSON.stringify({}),
      }

      const result = await this.eventRepository.appendWithProjection(
        event,
        (db) => this.projection.handleDeleted(db, event)
      )

      if (!result.success) {
        logger.error(`Error deleting ingredient ${id}`, result.getError())
        return result
      }

      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients.splice(index, 1)
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.error(`Error deleting ingredient ${id}`, error)
      return Result.fail(
        new DbQueryError(
          `Failed to delete ingredient ${id}`,
          "deleteIngredient",
          "Ingredient",
          error
        )
      )
    }
  }

  async getCompletedIngredients(
    listId: string
  ): Promise<Result<Ingredient[], DbQueryError>> {
    try {
      const result = await this.repository.getCompletedIngredients(listId)

      if (!result.success) {
        logger.error("Error fetching completed ingredients", result.getError())
        return result
      }

      return Result.ok(result.getValue()!)
    } catch (error) {
      logger.error("Error fetching completed ingredients", error)
      return Result.fail(
        new DbQueryError(
          "Failed to get completed ingredients",
          "getCompletedIngredients",
          "Ingredient",
          error
        )
      )
    }
  }

  async rebuildProjection(): Promise<Result<void, DbQueryError>> {
    const eventsResult = await this.eventRepository.getByAggregateType(
      AggregateTypes.INGREDIENT
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
          "Ingredient",
          error
        )
      )
    }
  }
}

export const ingredientService = new IngredientService()
