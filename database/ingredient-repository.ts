import * as SQLite from "expo-sqlite"
import { Ingredient } from "../types/Ingredient"
import { DbQueryError, NotImplementedError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { BaseRepository } from "./base-repository"

/**
 * Repository for ingredient operations
 */
export class IngredientRepository extends BaseRepository {
  protected readonly entityName = "Ingredient"

  /**
   * Create new ingredient repository
   * @param db Database instance
   */
  constructor(db: SQLite.SQLiteDatabase) {
    super(db, "IngredientRepository")
  }

  /**
   * Get all ingredients
   * @returns Result containing array of ingredients or error
   */
  async getAll(): Promise<Result<Ingredient[], DbQueryError>> {
    return this._executeQuery(async () => {
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

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        completed: row.completed === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    }, "getAll")
  }

  /**
   * Get ingredient by ID
   * @param id Ingredient ID
   * @returns Result containing ingredient or error
   */
  async getById(id: string): Promise<Result<Ingredient | null, DbQueryError>> {
    return this._executeQuery(async () => {
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
        return null
      }

      return {
        id: result.id,
        name: result.name,
        completed: result.completed === 1,
        created_at: result.created_at,
        updated_at: result.updated_at,
      }
    }, "getById")
  }

  /**
   * Add new ingredient
   * @param ingredient Ingredient to add
   * @returns Result indicating success or error
   */
  async add(ingredient: Ingredient): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `INSERT INTO ingredients (id, name, completed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ingredient.id,
        ingredient.name,
        ingredient.completed ? 1 : 0,
        ingredient.created_at || now,
        ingredient.updated_at || now
      )
    }, "add")
  }

  /**
   * Update existing ingredient
   * @param ingredient Ingredient to update
   * @returns Result indicating success or error
   */
  async update(ingredient: Ingredient): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE ingredients
           SET name = ?, completed = ?, updated_at = ?
           WHERE id = ?`,
        ingredient.name,
        ingredient.completed ? 1 : 0,
        now,
        ingredient.id
      )
    }, "update")
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

    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE ingredients
           SET completed = ?, updated_at = ?
           WHERE id = ?`,
        completed ? 1 : 0,
        now,
        id
      )
    }, "updateCompletion")
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

    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE ingredients
           SET name = ?, updated_at = ?
           WHERE id = ?`,
        name,
        now,
        id
      )
    }, "updateName")
  }

  /**
   * Delete ingredient
   * @param id Ingredient ID
   * @returns Result indicating success or error
   */
  async remove(id: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(`DELETE FROM ingredients WHERE id = ?`, id)
    }, "remove")
  }

  /**
   * Reorder ingredients
   * @param orderedIds Array of ingredient IDs in desired order
   * @returns Result with not implemented error
   */
  async reorderIngredients(
    orderedIds: string[]
  ): Promise<Result<void, NotImplementedError>> {
    const error = new NotImplementedError(
      "Ingredient reordering not yet implemented",
      "reorderIngredients"
    )
    this.logger.info("Reordering not yet implemented", orderedIds)
    return Result.fail(error)
  }
}
