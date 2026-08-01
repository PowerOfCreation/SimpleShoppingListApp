import { IngredientList } from "../types/IngredientList"
import { ShoppingListOverview } from "../types/ShoppingListOverview"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { BaseRepository } from "./base-repository"
import { SQLiteDatabase } from "expo-sqlite"

export class IngredientListRepository extends BaseRepository {
  protected readonly entityName = "IngredientList"

  constructor(db: SQLiteDatabase) {
    super(db, "IngredientListRepository")
  }

  async getAll(): Promise<Result<IngredientList[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
        sync_enabled: number
      }>(
        `SELECT id, name, created_at, updated_at, sync_enabled
         FROM ingredient_lists
         ORDER BY created_at DESC`
      )

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        syncEnabled: row.sync_enabled === 1,
      }))
    }, "getAll")
  }

  async getAllWithCounts(): Promise<
    Result<ShoppingListOverview[], DbQueryError>
  > {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
        sync_enabled: number
        total_count: number
        completed_count: number
      }>(
        `SELECT
           il.id,
           il.name,
           il.created_at,
           il.updated_at,
           il.sync_enabled,
           COUNT(i.id) as total_count,
           SUM(CASE WHEN i.completed = 1 THEN 1 ELSE 0 END) as completed_count
         FROM ingredient_lists il
         LEFT JOIN ingredients i ON il.id = i.list_id
         GROUP BY il.id, il.name, il.created_at, il.updated_at, il.sync_enabled
         ORDER BY il.created_at DESC`
      )

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        syncEnabled: row.sync_enabled === 1,
        totalCount: row.total_count || 0,
        completedCount: row.completed_count || 0,
      }))
    }, "getAllWithCounts")
  }

  /**
   * Ids of every sync-enabled list, for the reconcile pass - a focused
   * query rather than getAllWithCounts()'s join, since reconcile has no
   * use for ingredient counts.
   */
  async getSyncEnabledIds(): Promise<Result<string[], DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{ id: string }>(
        `SELECT id FROM ingredient_lists WHERE sync_enabled = 1`
      )
      return result.map((row) => row.id)
    }, "getSyncEnabledIds")
  }

  async getById(
    id: string
  ): Promise<Result<IngredientList | null, DbQueryError>> {
    return this._executeQuery(async () => {
      const result = await this.db.getFirstAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
        sync_enabled: number
      }>(
        `SELECT id, name, created_at, updated_at, sync_enabled
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
        syncEnabled: result.sync_enabled === 1,
      }
    }, "getById")
  }
}
