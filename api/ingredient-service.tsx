import { Ingredient } from "@/types/Ingredient"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"

const logger = createLogger("IngredientService")

export class IngredientService {
  ingredients: Ingredient[] = []
  initialLoad = true
  private repository: IngredientRepository

  constructor(repository?: IngredientRepository) {
    this.repository = repository || new IngredientRepository(getDatabase())
  }

  async GetIngredients(): Promise<Result<Ingredient[], DbQueryError>> {
    try {
      if (this.initialLoad) {
        this.initialLoad = false
        const result = await this.repository.getAll()

        if (result.success) {
          this.ingredients = result.getValue()!
        } else {
          logger.error("Error fetching ingredients", result.getError())
          return result
        }
      }

      return Result.ok(this.ingredients)
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
    ingredientName: string
  ): Promise<Result<void, ValidationError | DbQueryError>> {
    if (!ingredientName.trim()) {
      const error = new ValidationError(
        "Ingredient name can't be empty",
        "name"
      )
      return Result.fail(error)
    }

    try {
      const now = Date.now()
      const newIngredient: Ingredient = {
        name: ingredientName,
        completed: false,
        id: uuidv4(),
        created_at: now,
        updated_at: now,
      }

      // Add to repository
      const result = await this.repository.add(newIngredient)

      if (!result.success) {
        logger.error("Error adding ingredient", result.getError())
        return result
      }

      // Add to local cache
      this.ingredients.unshift(newIngredient)

      return Result.ok(undefined)
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
      const result = await this.repository.updateCompletion(id, completed)

      if (!result.success) {
        logger.error(
          `Error updating completion for ingredient ${id}`,
          result.getError()
        )
        return result
      }

      // Update local cache
      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].completed = completed
        this.ingredients[index].updated_at = Date.now()
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
      const result = await this.repository.updateName(id, name)

      if (!result.success) {
        logger.error(
          `Error updating name for ingredient ${id}`,
          result.getError()
        )
        return result
      }

      // Update local cache
      const index = this.ingredients.findIndex((ing) => ing.id === id)
      if (index !== -1) {
        this.ingredients[index].name = name
        this.ingredients[index].updated_at = Date.now()
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
}

export const ingredientService = new IngredientService()
