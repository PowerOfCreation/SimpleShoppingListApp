import * as SQLite from "expo-sqlite"
import { Ingredient } from "../types/Ingredient"

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
   * @returns Array of ingredients
   */
  async getAll(): Promise<Ingredient[]> {
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

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        completed: row.completed === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    } catch (error) {
      console.error("Error getting all ingredients:", error)
      throw error
    }
  }

  /**
   * Get ingredient by ID
   * @param id Ingredient ID
   * @returns Ingredient or null if not found
   */
  async getById(id: string): Promise<Ingredient | null> {
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
        return null
      }

      return {
        id: result.id,
        name: result.name,
        completed: result.completed === 1,
        created_at: result.created_at,
        updated_at: result.updated_at,
      }
    } catch (error) {
      console.error(`Error getting ingredient with ID ${id}:`, error)
      throw error
    }
  }

  /**
   * Add new ingredient
   * @param ingredient Ingredient to add
   */
  async add(ingredient: Ingredient): Promise<void> {
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
    } catch (error) {
      console.error("Error adding ingredient:", error)
      throw error
    }
  }

  /**
   * Update existing ingredient
   * @param ingredient Ingredient to update
   */
  async update(ingredient: Ingredient): Promise<void> {
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
    } catch (error) {
      console.error(
        `Error updating ingredient with ID ${ingredient.id}:`,
        error
      )
      throw error
    }
  }

  /**
   * Update ingredient completion status
   * @param id Ingredient ID
   * @param completed Completion status
   */
  async updateCompletion(id: string, completed: boolean): Promise<void> {
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
    } catch (error) {
      console.error(
        `Error updating completion status for ingredient with ID ${id}:`,
        error
      )
      throw error
    }
  }

  /**
   * Delete ingredient
   * @param id Ingredient ID
   */
  async remove(id: string): Promise<void> {
    try {
      await this.db.runAsync(`DELETE FROM ingredients WHERE id = ?`, id)
    } catch (error) {
      console.error(`Error removing ingredient with ID ${id}:`, error)
      throw error
    }
  }

  /**
   * Reorder ingredients
   * @param orderedIds Array of ingredient IDs in desired order
   */
  async reorderIngredients(orderedIds: string[]): Promise<void> {
    // This will be implemented later when we add support for ordering
    // For now, we'll just log a message
    console.log("Reordering not yet implemented:", orderedIds)
  }
}
