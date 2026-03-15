import { IngredientList } from "@/types/IngredientList"
import { ShoppingListOverview } from "@/types/ShoppingListOverview"
import "react-native-get-random-values"
import { v4 as uuidv4 } from "uuid"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbQueryError, ValidationError } from "@/api/common/error-types"

const logger = createLogger("ShoppingListService")

export class ShoppingListService {
  private repository: IngredientListRepository

  constructor(repository?: IngredientListRepository) {
    this.repository = repository || new IngredientListRepository(getDatabase())
  }

  async createList(
    listName: string
  ): Promise<Result<string, ValidationError | DbQueryError>> {
    if (!listName.trim()) {
      const error = new ValidationError(
        "Shopping list name can't be empty",
        "name"
      )
      return Result.fail(error)
    }

    try {
      const now = Date.now()
      const newList: IngredientList = {
        id: uuidv4(),
        name: listName,
        created_at: now,
        updated_at: now,
      }

      // Add to repository
      const result = await this.repository.add(newList)

      if (!result.success) {
        const error = result.getError()
        logger.error("Error creating shopping list", error)
        return Result.fail(error)
      }

      return Result.ok(newList.id)
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
      const error = new ValidationError(
        "Shopping list name can't be empty",
        "name"
      )
      return Result.fail(error)
    }

    try {
      const existingListResult = await this.repository.getById(listId)

      if (!existingListResult.success) {
        const error = existingListResult.getError()
        logger.error("Error fetching shopping list", error)
        return Result.fail(error)
      }

      const existingList = existingListResult.getValue()
      if (!existingList) {
        const error = new DbQueryError(
          "Shopping list not found",
          "updateName",
          "IngredientList"
        )
        return Result.fail(error)
      }

      const updatedList: IngredientList = {
        ...existingList,
        name: newName,
        updated_at: Date.now(),
      }

      const result = await this.repository.update(updatedList)

      if (!result.success) {
        const error = result.getError()
        logger.error("Error updating shopping list name", error)
        return Result.fail(error)
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
}

export const shoppingListService = new ShoppingListService()
