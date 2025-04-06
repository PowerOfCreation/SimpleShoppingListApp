import * as SQLite from "expo-sqlite"
import { Ingredient } from "../types/Ingredient"
import { createLogger } from "@/api/common/logger"
import { DbQueryError, NotImplementedError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

const logger = createLogger("IngredientRepository")

/**
 * Repository for ingredient operations
 */
export class IngredientRepository {
  private db: SQLite.SQLiteDatabase

  /**
   * Create new ingredient repository
   * @param db Optional database instance. If not provided, will use getDatabase()
   */
  constructor(db: SQLite.SQLiteDatabase) {
    this.db = db
  }

  /**
   * Get all ingredients
   * @returns Result containing array of ingredients or error
   */
  async getAll(): Promise<Result<Ingredient[], DbQueryError>> {
    try {
      const result = await this.db.getAllAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(
        `SELECT id, name, completed, created_at, updated_at
         FROM ingredients
         ORDER BY completed ASC, created_at DESC`
      )

      return Result.ok(
        result.map((row) => ({
          id: row.id,
          name: row.name,
          completed: row.completed === 1,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      )
    } catch (error) {
      const dbError = new DbQueryError(
        "Failed to get all ingredients",
        "getAll",
        "Ingredient",
        error
      )
      logger.error("Error getting all ingredients", dbError)
      return Result.fail(dbError)
    }
  }

  /**
   * Get ingredient by ID
   * @param id Ingredient ID
   * @returns Result containing ingredient or error
   */
  async getById(id: string): Promise<Result<Ingredient | null, DbQueryError>> {
    try {
      const result = await this.db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(
        `SELECT id, name, completed, created_at, updated_at
         FROM ingredients
         WHERE id = ?`,
        id
      )

      if (!result) {
        return Result.ok(null)
      }

      return Result.ok({
        id: result.id,
        name: result.name,
        completed: result.completed === 1,
        created_at: result.created_at,
        updated_at: result.updated_at,
      })
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to get ingredient with ID ${id}`,
        "getById",
        "Ingredient",
        error
      )
      logger.error(`Error getting ingredient with ID ${id}`, dbError)
      return Result.fail(dbError)
    }
  }

  /**
   * Add new ingredient
   * @param ingredient Ingredient to add
   * @returns Result indicating success or error
   */
  async add(ingredient: Ingredient): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    try {
      await this.db.runAsync(
        `INSERT INTO ingredients (id, name, completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        ingredient.id,
        ingredient.name,
        ingredient.completed ? 1 : 0,
        ingredient.created_at || now,
        ingredient.updated_at || now
      )
      return Result.ok(undefined)
    } catch (error) {
      const dbError = new DbQueryError(
        "Failed to add ingredient",
        "add",
        "Ingredient",
        error
      )
      logger.error("Error adding ingredient", dbError)
      return Result.fail(dbError)
    }
  }

  /**
   * Update existing ingredient
   * @param ingredient Ingredient to update
   * @returns Result indicating success or error
   */
  async update(ingredient: Ingredient): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    try {
      await this.db.runAsync(
        `UPDATE ingredients
         SET name = ?, completed = ?, updated_at = ?
         WHERE id = ?`,
        ingredient.name,
        ingredient.completed ? 1 : 0,
        now,
        ingredient.id
      )
      return Result.ok(undefined)
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to update ingredient with ID ${ingredient.id}`,
        "update",
        "Ingredient",
        error
      )
      logger.error(
        `Error updating ingredient with ID ${ingredient.id}`,
        dbError
      )
      return Result.fail(dbError)
    }
  }

  /**
   * Update ingredient completion status
   * @param id Ingredient ID
   * @param completed Completion status
   * @returns Result indicating success or error
   */
  async updateCompletion(
    id: string,
    completed: boolean
  ): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    try {
      await this.db.runAsync(
        `UPDATE ingredients
         SET completed = ?, updated_at = ?
         WHERE id = ?`,
        completed ? 1 : 0,
        now,
        id
      )
      return Result.ok(undefined)
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to update completion status for ingredient with ID ${id}`,
        "updateCompletion",
        "Ingredient",
        error
      )
      logger.error(
        `Error updating completion status for ingredient with ID ${id}`,
        dbError
      )
      return Result.fail(dbError)
    }
  }

  /**
   * Update ingredient name
   * @param id Ingredient ID
   * @param name New name
   * @returns Result indicating success or error
   */
  async updateName(
    id: string,
    name: string
  ): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    try {
      await this.db.runAsync(
        `UPDATE ingredients
         SET name = ?, updated_at = ?
         WHERE id = ?`,
        name,
        now,
        id
      )
      return Result.ok(undefined)
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to update name for ingredient with ID ${id}`,
        "updateName",
        "Ingredient",
        error
      )
      logger.error(`Error updating name for ingredient with ID ${id}`, dbError)
      return Result.fail(dbError)
    }
  }

  /**
   * Delete ingredient
   * @param id Ingredient ID
   * @returns Result indicating success or error
   */
  async remove(id: string): Promise<Result<void, DbQueryError>> {
    try {
      await this.db.runAsync(`DELETE FROM ingredients WHERE id = ?`, id)
      return Result.ok(undefined)
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to remove ingredient with ID ${id}`,
        "remove",
        "Ingredient",
        error
      )
      logger.error(`Error removing ingredient with ID ${id}`, dbError)
      return Result.fail(dbError)
    }
  }

  /**
   * Reorder ingredients
   * @param orderedIds Array of ingredient IDs in desired order
   * @returns Result with not implemented error
   */
  async reorderIngredients(
    orderedIds: string[]
  ): Promise<Result<void, NotImplementedError>> {
    // This will be implemented later when we add support for ordering
    const error = new NotImplementedError(
      "Ingredient reordering not yet implemented",
      "reorderIngredients"
    )
    logger.info("Reordering not yet implemented", orderedIds)
    return Result.fail(error)
  }
}
