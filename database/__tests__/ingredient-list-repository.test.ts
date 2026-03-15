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

    // Clear the tables before each test
    await db.execAsync(`DROP TABLE IF EXISTS ingredient_lists;`)
    await db.execAsync(`DROP TABLE IF EXISTS ingredients;`)

    // Set up database schema for each test
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        list_id TEXT,
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

  describe("getAllWithCounts", () => {
    it("should return lists with ingredient counts", async () => {
      // Insert test data - 3 lists with different ingredient counts
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'Shopping List', 2000, 2000),
        ('2', 'Weekly Groceries', 3000, 3000),
        ('3', 'Empty List', 1000, 1000);
      `)

      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES
        ('i1', 'Milk', 1, '1', 2000, 2000),
        ('i2', 'Bread', 0, '1', 2000, 2000),
        ('i3', 'Eggs', 1, '1', 2000, 2000),
        ('i4', 'Butter', 1, '2', 3000, 3000),
        ('i5', 'Cheese', 1, '2', 3000, 3000),
        ('i6', 'Ham', 0, '2', 3000, 3000),
        ('i7', 'Tomatoes', 0, '2', 3000, 3000);
      `)

      const result = await repository.getAllWithCounts()
      expect(result.success).toBe(true)

      const lists = result.getValue()!
      expect(lists.length).toBe(3)

      // Weekly Groceries (newest) - 4 total, 2 completed
      expect(lists[0].id).toBe("2")
      expect(lists[0].name).toBe("Weekly Groceries")
      expect(lists[0].totalCount).toBe(4)
      expect(lists[0].completedCount).toBe(2)

      // Shopping List - 3 total, 2 completed
      expect(lists[1].id).toBe("1")
      expect(lists[1].name).toBe("Shopping List")
      expect(lists[1].totalCount).toBe(3)
      expect(lists[1].completedCount).toBe(2)

      // Empty List (oldest) - 0 total, 0 completed
      expect(lists[2].id).toBe("3")
      expect(lists[2].name).toBe("Empty List")
      expect(lists[2].totalCount).toBe(0)
      expect(lists[2].completedCount).toBe(0)
    })

    it("should return empty array when no lists exist", async () => {
      const result = await repository.getAllWithCounts()
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })

    it("should handle lists with all completed ingredients", async () => {
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'All Done', 1000, 1000);
      `)

      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES
        ('i1', 'Item 1', 1, '1', 1000, 1000),
        ('i2', 'Item 2', 1, '1', 1000, 1000);
      `)

      const result = await repository.getAllWithCounts()
      expect(result.success).toBe(true)

      const lists = result.getValue()!
      expect(lists.length).toBe(1)
      expect(lists[0].totalCount).toBe(2)
      expect(lists[0].completedCount).toBe(2)
    })

    it("should handle lists with no completed ingredients", async () => {
      await db.execAsync(`
        INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES
        ('1', 'None Done', 1000, 1000);
      `)

      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES
        ('i1', 'Item 1', 0, '1', 1000, 1000),
        ('i2', 'Item 2', 0, '1', 1000, 1000),
        ('i3', 'Item 3', 0, '1', 1000, 1000);
      `)

      const result = await repository.getAllWithCounts()
      expect(result.success).toBe(true)

      const lists = result.getValue()!
      expect(lists.length).toBe(1)
      expect(lists[0].totalCount).toBe(3)
      expect(lists[0].completedCount).toBe(0)
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
