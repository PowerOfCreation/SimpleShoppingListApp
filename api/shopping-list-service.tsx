import { IngredientList } from "@/types/IngredientList"
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
}

export const shoppingListService = new ShoppingListService()
