import * as SQLite from "expo-sqlite"
import { IngredientRepository } from "../ingredient-repository"
import { getDatabase } from "../database"
import { Ingredient } from "../../types/Ingredient"

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

      // Verify results - should be sorted by completed ASC (0 first), then created_at DESC (newest first)
      expect(result.length).toBe(3)
      expect(result[0].id).toBe("1") // Milk (not completed, newer)
      expect(result[1].id).toBe("3") // Bread (not completed, older)
      expect(result[2].id).toBe("2") // Eggs (completed)

      // Verify boolean conversion
      expect(result[0].completed).toBe(false)
      expect(result[2].completed).toBe(true)
    })

    it("should return empty array when no ingredients exist", async () => {
      const result = await repository.getAll()
      expect(result).toEqual([])
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

      // Verify results
      expect(result).toEqual({
        id: "1",
        name: "Milk",
        completed: false,
        created_at: 1000,
        updated_at: 1000,
      })
    })

    it("should return null when ingredient not found", async () => {
      const result = await repository.getById("nonexistent")
      expect(result).toBeNull()
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
      await repository.add(ingredient)

      // Verify the ingredient was added
      const result = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(result).toEqual({
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
      await repository.add(ingredient)

      // Verify the ingredient was added with the provided timestamps
      const result = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(result).toEqual({
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
      await repository.update(ingredient)

      // Verify the ingredient was updated
      const result = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(result).toEqual({
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
      await repository.updateCompletion("1", true)

      // Verify the completion status was updated
      const result = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(result).toEqual({
        id: "1",
        name: "Milk",
        completed: 1, // Should change
        created_at: 1000, // Should not change
        updated_at: now, // Should update
      })
    })
  })

  describe("remove", () => {
    it("should remove an ingredient from the database", async () => {
      // Insert a test ingredient
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('1', 'Milk', 0, 1000, 1000);
      `)

      // Call the method
      await repository.remove("1")

      // Verify the ingredient was removed
      const result = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(`SELECT * FROM ingredients WHERE id = ?`, "1")

      expect(result).toBeNull()
    })
  })

  describe("reorderIngredients", () => {
    it("should log a message that reordering is not yet implemented", async () => {
      // Spy on console.log
      const consoleSpy = jest.spyOn(console, "log")

      // Call the method
      await repository.reorderIngredients(["1", "2", "3"])

      // Verify that console.log was called with the expected message
      expect(consoleSpy).toHaveBeenCalledWith(
        "Reordering not yet implemented:",
        ["1", "2", "3"]
      )
    })
  })
})
