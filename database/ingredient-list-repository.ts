import { IngredientList } from "../types/IngredientList"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { BaseRepository } from "./base-repository"
import { SQLiteDatabase } from "expo-sqlite"

/**
 * Repository for ingredient list operations
 */
export class IngredientListRepository extends BaseRepository {
  protected readonly entityName = "IngredientList"

  /**
   * Create new ingredient list repository
   * @param db Database instance
   */
  constructor(db: SQLiteDatabase) {
    super(db, "IngredientListRepository")
  }

  /**
   * Get all ingredient lists
   * @returns Result containing array of ingredient lists or error
   */
  async getAll(): Promise<Result<IngredientList[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
      }>(
        `SELECT id, name, created_at, updated_at
         FROM ingredient_lists
         ORDER BY created_at DESC`
      )

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    }, "getAll")
  }

  /**
   * Get ingredient list by ID
   * @param id Ingredient list ID
   * @returns Result containing ingredient list or error
   */
  async getById(
    id: string
  ): Promise<Result<IngredientList | null, DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getFirstAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
      }>(
        `SELECT id, name, created_at, updated_at
         FROM ingredient_lists
         WHERE id = ?`,
        id
      )

      if (!result) {
        return null
      }

      return {
        id: result.id,
        name: result.name,
        created_at: result.created_at,
        updated_at: result.updated_at,
      }
    }, "getById")
  }

  /**
   * Add new ingredient list
   * @param list Ingredient list to add
   * @returns Result indicating success or error
   */
  async add(list: IngredientList): Promise<Result<void, DbQueryError>> {
    const now = Date.now()

    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        list.id,
        list.name,
        list.created_at || now,
        list.updated_at || now
      )
    }, "add")
  }

  /**
   * Update existing ingredient list
   * @param list Ingredient list with updated data
   * @returns Result indicating success or error
   */
  async update(list: IngredientList): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(
        `UPDATE ingredient_lists
           SET name = ?, updated_at = ?
           WHERE id = ?`,
        list.name,
        list.updated_at || Date.now(),
        list.id
      )
    }, "update")
  }

  /**
   * Delete ingredient list
   * @param id Ingredient list ID
   * @returns Result indicating success or error
   */
  async delete(id: string): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.runAsync(`DELETE FROM ingredient_lists WHERE id = ?`, id)
    }, "delete")
  }
}
