import * as SQLite from "expo-sqlite"
import { IngredientRepository } from "../ingredient-repository"
import { getDatabase } from "../database"
import { Ingredient } from "../../types/Ingredient"
import { NotImplementedError } from "@/api/common/error-types"

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("IngredientRepository", () => {
  // We'll use the singleton instance for tests
  let db: SQLite.SQLiteDatabase
  let repository: IngredientRepository

  beforeEach(async () => {
    db = getDatabase()
    repository = new IngredientRepository(db)

    // Clear the ingredients table before each test
    await db.execAsync(`DROP TABLE IF EXISTS ingredients;`)

    // Set up database schema for each test
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        list_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)
  })

  describe("getAll", () => {
    it("should return all ingredients sorted by completion and creation date", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 2000, 2000, NULL),
        ('2', 'Eggs', 1, 'list-1', 3000, 3000, 3000),
        ('3', 'Bread', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Call the method
      const result = await repository.getAll("list-1")
      expect(result.success).toBe(true)

      const ingredients = result.getValue()!
      // Verify results - should be sorted by completed ASC (0 first), then created_at DESC (newest first)
      expect(ingredients.length).toBe(3)
      expect(ingredients[0].id).toBe("1") // Milk (not completed, newer)
      expect(ingredients[1].id).toBe("3") // Bread (not completed, older)
      expect(ingredients[2].id).toBe("2") // Eggs (completed)

      // Verify boolean conversion
      expect(ingredients[0].completed).toBe(false)
      expect(ingredients[2].completed).toBe(true)
    })

    it("should return empty array when no ingredients exist", async () => {
      const result = await repository.getAll("list-1")
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })
  })

  describe("getById", () => {
    it("should return an ingredient by ID", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Call the method
      const result = await repository.getById("1")
      expect(result.success).toBe(true)

      // Verify results
      expect(result.getValue()).toEqual({
        id: "1",
        name: "Milk",
        completed: false,
        list_id: "list-1",
        created_at: 1000,
        updated_at: 1000,
      })
    })

    it("should return null when ingredient not found", async () => {
      const result = await repository.getById("nonexistent")
      expect(result.success).toBe(true)
      const value = result.getValue()
      expect(value).toBeNull()
    })
  })

  describe("add", () => {
    it("should add an ingredient to the database", async () => {
      // Mock Date.now for consistent testing
      const now = 1234567890
      jest.spyOn(Date, "now").mockReturnValue(now)

      // Test data
      const ingredient: Ingredient = {
        id: "1",
        name: "Milk",
        completed: false,
        list_id: "list-1",
      }

      // Call the method
      const result = await repository.add(ingredient)
      expect(result.success).toBe(true)

      // Verify the ingredient was added
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 0,
        list_id: "list-1",
        created_at: now,
        updated_at: now,
        completed_at: null,
      })
    })

    it("should use provided timestamps if available", async () => {
      // Test data with timestamps
      const ingredient: Ingredient = {
        id: "1",
        name: "Milk",
        completed: false,
        list_id: "list-1",
        created_at: 1000,
        updated_at: 2000,
      }

      // Call the method
      const result = await repository.add(ingredient)
      expect(result.success).toBe(true)

      // Verify the ingredient was added with the provided timestamps
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 0,
        list_id: "list-1",
        created_at: 1000,
        updated_at: 2000,
        completed_at: null,
      })
    })
  })

  describe("update", () => {
    it("should update an ingredient in the database", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Mock Date.now for consistent testing
      const now = 1234567890
      jest.spyOn(Date, "now").mockReturnValue(now)

      // Test data
      const ingredient: Ingredient = {
        id: "1",
        name: "Milk Updated",
        completed: true,
        list_id: "list-1",
      }

      // Call the method
      const result = await repository.update(ingredient)
      expect(result.success).toBe(true)

      // Verify the ingredient was updated
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk Updated",
        completed: 1,
        list_id: "list-1",
        created_at: 1000, // Should not change
        updated_at: now, // Should update
        completed_at: null,
      })
    })
  })

  describe("updateCompletion", () => {
    it("should update an ingredient completion status", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Mock Date.now for consistent testing
      const now = 1234567890
      jest.spyOn(Date, "now").mockReturnValue(now)

      // Call the method
      const result = await repository.updateCompletion("1", true)
      expect(result.success).toBe(true)

      // Verify the completion status was updated
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 1, // Should change
        list_id: "list-1",
        created_at: 1000, // Should not change
        updated_at: now, // Should update
        completed_at: now, // Should be set to now
      })
    })
  })

  describe("updateName", () => {
    it("should update an ingredient name", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Mock Date.now for consistent testing
      const now = 1234567890
      jest.spyOn(Date, "now").mockReturnValue(now)

      // Call the method
      const result = await repository.updateName("1", "Almond Milk")
      expect(result.success).toBe(true)

      // Verify the name was updated
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Almond Milk", // Should change
        completed: 0,
        list_id: "list-1",
        created_at: 1000, // Should not change
        updated_at: now, // Should update
        completed_at: null,
      })
    })

    it("should return an error if the update fails", async () => {
      const ingredientId = "1"
      const newName = "Almond Milk"
      const dbError = new Error("Database error")

      // Mock db.runAsync to throw an error
      jest.spyOn(db, "runAsync").mockRejectedValueOnce(dbError)

      // Call the method and expect it to return a failure result
      const result = await repository.updateName(ingredientId, newName)
      expect(result.success).toBe(false)
      expect(result.getError()).toBeTruthy()
    })
  })

  describe("remove", () => {
    it("should remove an ingredient from the database", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      // Verify the ingredient exists
      let result = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM ingredients WHERE id = ?`,
        "1"
      )
      expect(result).not.toBeNull()

      // Call the method
      const removeResult = await repository.remove("1")
      expect(removeResult.success).toBe(true)

      // Verify the ingredient was removed
      result = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM ingredients WHERE id = ?`,
        "1"
      )
      expect(result).toBeNull()
    })
  })

  describe("reorderIngredients", () => {
    it("should return not implemented error", async () => {
      // Call the method
      const result = await repository.reorderIngredients(["1", "2", "3"])

      // Verify the result is a Not Implemented error
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(NotImplementedError)
    })
  })

  describe("getCompletedIngredients", () => {
    it("should return only completed ingredients ordered by completion date", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL),
        ('2', 'Eggs', 1, 'list-1', 2000, 2000, 2000),
        ('3', 'Bread', 1, 'list-1', 3000, 3000, 3000),
        ('4', 'Butter', 1, 'list-1', 4000, 4000, 1500);
      `)

      // Call the method
      const result = await repository.getCompletedIngredients("list-1")
      expect(result.success).toBe(true)

      const ingredients = result.getValue()!
      // Verify results - should only get completed items, sorted by completed_at DESC (most recent first)
      expect(ingredients.length).toBe(3)
      expect(ingredients[0].id).toBe("3") // Bread (completed_at: 3000)
      expect(ingredients[1].id).toBe("2") // Eggs (completed_at: 2000)
      expect(ingredients[2].id).toBe("4") // Butter (completed_at: 1500)

      // Verify all are completed
      expect(ingredients[0].completed).toBe(true)
      expect(ingredients[1].completed).toBe(true)
      expect(ingredients[2].completed).toBe(true)
    })

    it("should return empty array when no completed ingredients exist", async () => {
      // Insert only non-completed ingredients
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 0, 'list-1', 1000, 1000, NULL);
      `)

      const result = await repository.getCompletedIngredients("list-1")
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })

    it("should filter by list_id", async () => {
      // Insert ingredients for different lists
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at, completed_at) VALUES
        ('1', 'Milk', 1, 'list-1', 1000, 1000, 1000),
        ('2', 'Eggs', 1, 'list-2', 2000, 2000, 2000);
      `)

      const result = await repository.getCompletedIngredients("list-1")
      expect(result.success).toBe(true)

      const ingredients = result.getValue()!
      expect(ingredients.length).toBe(1)
      expect(ingredients[0].id).toBe("1")
    })
  })
})
