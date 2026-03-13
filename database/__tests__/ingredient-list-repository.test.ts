import * as SQLite from "expo-sqlite"
import { IngredientListRepository } from "../ingredient-list-repository"
import { getDatabase } from "../database"
import { IngredientList } from "../../types/IngredientList"

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("IngredientListRepository", () => {
  let db: SQLite.SQLiteDatabase
  let repository: IngredientListRepository

  beforeEach(async () => {
    db = getDatabase()
    repository = new IngredientListRepository(db)

    // Clear the ingredient_lists table before each test
    await db.execAsync(`DROP TABLE IF EXISTS ingredient_lists;`)

    // Set up database schema for each test
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  describe("getAll", () => {
    it("should return all ingredient lists sorted by creation date", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'Shopping List', 2000, 2000),
        ('2', 'Weekly Groceries', 3000, 3000),
        ('3', 'Party Supplies', 1000, 1000);
      `)

      // Call the method
      const result = await repository.getAll()
      expect(result.success).toBe(true)

      const lists = result.getValue()!
      // Verify results - should be sorted by created_at DESC (newest first)
      expect(lists.length).toBe(3)
      expect(lists[0].id).toBe("2") // Weekly Groceries (newest)
      expect(lists[1].id).toBe("1") // Shopping List
      expect(lists[2].id).toBe("3") // Party Supplies (oldest)
    })

    it("should return empty array when no lists exist", async () => {
      const result = await repository.getAll()
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })
  })

  describe("getById", () => {
    it("should return an ingredient list by ID", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'Shopping List', 1000, 1000);
      `)

      // Call the method
      const result = await repository.getById("1")
      expect(result.success).toBe(true)

      // Verify results
      expect(result.getValue()).toEqual({
        id: "1",
        name: "Shopping List",
        created_at: 1000,
        updated_at: 1000,
      })
    })

    it("should return null for non-existent ID", async () => {
      const result = await repository.getById("nonexistent")
      expect(result.success).toBe(true)
      expect(result.getValue()).toBeNull()
    })
  })

  describe("add", () => {
    it("should insert a new ingredient list", async () => {
      const newList: IngredientList = {
        id: "1",
        name: "Shopping List",
        created_at: 1000,
        updated_at: 1000,
      }

      // Add the list
      const result = await repository.add(newList)
      expect(result.success).toBe(true)

      // Verify it was inserted
      const rows = await db.getAllAsync<IngredientList>(`
        SELECT * FROM ingredient_lists WHERE id = '1';
      `)
      expect(rows[0]).toEqual(newList)
    })

    it("should fail when inserting duplicate ID", async () => {
      const list: IngredientList = {
        id: "1",
        name: "Shopping List",
        created_at: 1000,
        updated_at: 1000,
      }

      // Insert once
      await repository.add(list)

      // Try to insert again with same ID
      const result = await repository.add(list)
      expect(result.success).toBe(false)
    })
  })

  describe("update", () => {
    it("should update an existing ingredient list", async () => {
      // Insert initial data
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'Shopping List', 1000, 1000);
      `)

      // Update the list
      const updatedList: IngredientList = {
        id: "1",
        name: "Updated Shopping List",
        created_at: 1000,
        updated_at: 2000,
      }

      const result = await repository.update(updatedList)
      expect(result.success).toBe(true)

      // Verify it was updated
      const rows = await db.getAllAsync<IngredientList>(`
        SELECT * FROM ingredient_lists WHERE id = '1';
      `)
      expect(rows[0]).toEqual(updatedList)
    })

    it("should return success even when updating non-existent list", async () => {
      const list: IngredientList = {
        id: "nonexistent",
        name: "Non-existent",
        created_at: 1000,
        updated_at: 1000,
      }

      const result = await repository.update(list)
      expect(result.success).toBe(true)
    })
  })

  describe("delete", () => {
    it("should delete an existing ingredient list", async () => {
      // Insert test data
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'Shopping List', 1000, 1000);
      `)

      // Delete the list
      const result = await repository.delete("1")
      expect(result.success).toBe(true)

      // Verify it was deleted
      const rows = await db.getAllAsync<IngredientList>(`
        SELECT * FROM ingredient_lists WHERE id = '1';
      `)
      expect(rows.length).toBe(0)
    })

    it("should return success even when deleting non-existent list", async () => {
      const result = await repository.delete("nonexistent")
      expect(result.success).toBe(true)
    })
  })
})
