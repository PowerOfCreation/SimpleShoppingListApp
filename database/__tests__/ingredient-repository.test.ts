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

    // Set up database schema for each test
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  describe("getAll", () => {
    it("should return all ingredients sorted by completion and creation date", async () => {
      // Insert test data
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ingredients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 2000, 2000),
        ('2', 'Eggs', 1, 3000, 3000),
        ('3', 'Bread', 0, 1000, 1000);
      `)

      // Call the method
      const result = await repository.getAll()
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
      const result = await repository.getAll()
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })
  })

  describe("getById", () => {
    it("should return an ingredient by ID", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
      `)

      // Call the method
      const result = await repository.getById("1")
      expect(result.success).toBe(true)

      // Verify results
      expect(result.getValue()).toEqual({
        id: "1",
        name: "Milk",
        completed: false,
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
      }

      // Call the method
      const result = await repository.add(ingredient)
      expect(result.success).toBe(true)

      // Verify the ingredient was added
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 0,
        created_at: now,
        updated_at: now,
      })
    })

    it("should use provided timestamps if available", async () => {
      // Test data with timestamps
      const ingredient: Ingredient = {
        id: "1",
        name: "Milk",
        completed: false,
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
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 0,
        created_at: 1000,
        updated_at: 2000,
      })
    })
  })

  describe("update", () => {
    it("should update an ingredient in the database", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
      `)

      // Mock Date.now for consistent testing
      const now = 1234567890
      jest.spyOn(Date, "now").mockReturnValue(now)

      // Test data
      const ingredient: Ingredient = {
        id: "1",
        name: "Milk Updated",
        completed: true,
      }

      // Call the method
      const result = await repository.update(ingredient)
      expect(result.success).toBe(true)

      // Verify the ingredient was updated
      const dbResult = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk Updated",
        completed: 1,
        created_at: 1000, // Should not change
        updated_at: now, // Should update
      })
    })
  })

  describe("updateCompletion", () => {
    it("should update an ingredient completion status", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
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
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Milk",
        completed: 1, // Should change
        created_at: 1000, // Should not change
        updated_at: now, // Should update
      })
    })
  })

  describe("updateName", () => {
    it("should update an ingredient name", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
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
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(dbResult).toEqual({
        id: "1",
        name: "Almond Milk", // Should change
        completed: 0,
        created_at: 1000, // Should not change
        updated_at: now, // Should update
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
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
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
})
