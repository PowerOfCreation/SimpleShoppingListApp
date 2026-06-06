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

  async getAllWithCounts(): Promise<
    Result<ShoppingListOverview[], DbQueryError>
  > {
    return this._executeQuery(async () => {
      const result = await this.db.getAllAsync<{
        id: string
        name: string
        created_at: number
        updated_at: number
        total_count: number
        completed_count: number
      }>(
        `SELECT
           il.id,
           il.name,
           il.created_at,
           il.updated_at,
           COUNT(i.id) as total_count,
           SUM(CASE WHEN i.completed = 1 THEN 1 ELSE 0 END) as completed_count
         FROM ingredient_lists il
         LEFT JOIN ingredients i ON il.id = i.list_id
         GROUP BY il.id, il.name, il.created_at, il.updated_at
         ORDER BY il.created_at DESC`
      )

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        totalCount: row.total_count || 0,
        completedCount: row.completed_count || 0,
      }))
    }, "getAllWithCounts")
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
}
