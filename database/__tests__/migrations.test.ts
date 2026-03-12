import * as SQLite from "expo-sqlite"
import { executeMigrations } from "../migrations"
import { getDatabase, DB_VERSION } from "../database"
import { DbMigrationError } from "@/api/common/error-types"
import { Ingredient } from "../../types/Ingredient"
import { getItem } from "../../api/common/async-storage"

// Import the createTables function directly from migrations
const { createTables, migrateFromAsyncStorage, createDefaultList } =
  jest.requireActual("../migrations")

// Mock DB_NAME to use in-memory database
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

// Mock async storage import
jest.mock("../../api/common/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
}))

describe("Migrations", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    // Get a fresh database connection for each test
    db = getDatabase()

    // Clear any existing tables
    await db.execAsync(`
      DROP TABLE IF EXISTS database_version;
      DROP TABLE IF EXISTS ingredients;
      DROP TABLE IF EXISTS ingredient_lists;
    `)
  })

  describe("executeMigrations", () => {
    it("should create database tables on first run", async () => {
      // Test as if it's the first run
      const result = await executeMigrations(db, true, 0)
      expect(result.success).toBe(true)

      // Verify tables were created
      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND (name='ingredients' OR name='database_version' OR name='ingredient_lists');`
      )
      expect(tables.length).toBe(3)
      expect(tables.some((t) => t.name === "ingredients")).toBe(true)
      expect(tables.some((t) => t.name === "database_version")).toBe(true)
      expect(tables.some((t) => t.name === "ingredient_lists")).toBe(true)

      // Verify default list was created
      const lists = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM ingredient_lists;`
      )
      expect(lists.length).toBe(1)
      expect(lists[0].name).toBe("Standard List")

      // Verify version was inserted
      const versionRow = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?;`,
        DB_VERSION
      )
      expect(versionRow && versionRow.version).toBe(DB_VERSION)
    })

    it("should handle migration failures gracefully", async () => {
      // Mock db.runAsync to throw an error during table creation
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Mock database error")
      })

      const result = await executeMigrations(db, true, 0)

      // Should fail with proper error type
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
    })

    it("should update database version after successful migration", async () => {
      // Clear existing tables
      await db.execAsync(`
        DROP TABLE IF EXISTS ingredients;
        DROP TABLE IF EXISTS database_version;
        DROP TABLE IF EXISTS ingredient_lists;
      `)

      // Create tables manually for version 1
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ingredients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
        
        INSERT INTO database_version (version, migration_date) VALUES (1, ${Date.now()});
      `)

      const result = await executeMigrations(db, false, 1)

      if (!result.success) {
        // Log error for debugging
        const error = result.getError()
        throw new Error(
          `Migration failed: ${error?.message}. Cause: ${error?.cause}`
        )
      }

      expect(result.success).toBe(true)

      // Check version was updated to 2
      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?;`,
        DB_VERSION
      )
      expect(version && version.version).toBe(DB_VERSION)
    })
  })

  describe("migrateFromAsyncStorage", () => {
    let defaultListId: string

    beforeEach(async () => {
      // Reset mocks before each test
      jest.clearAllMocks()
      jest.mocked(getItem).mockResolvedValue(null)

      // Use the actual createTables function to set up the database structure
      const tablesResult = await createTables(db)
      expect(tablesResult.success).toBe(true)

      // Create a default list for testing
      const listResult = await createDefaultList(db)
      expect(listResult.success).toBe(true)
      defaultListId = listResult.getValue()!
    })

    it("should handle empty ingredients array gracefully", async () => {
      jest.mocked(getItem).mockResolvedValueOnce([])

      const result = await migrateFromAsyncStorage(db, defaultListId)

      expect(result.success).toBe(true)
      expect(getItem).toHaveBeenCalledWith("ingredients")

      // Verify no ingredients were inserted
      const count = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM ingredients"
      )
      expect(count?.count).toBe(0)
    })

    it("should successfully migrate ingredients from AsyncStorage", async () => {
      // Mock ingredients data
      const mockIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Salt",
          completed: false,
          list_id: "list-1",
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "2",
          name: "Pepper",
          completed: true,
          list_id: "list-1",
          created_at: 2000,
          updated_at: 2000,
        },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      const result = await migrateFromAsyncStorage(db, defaultListId)

      expect(result.success).toBe(true)

      // Verify ingredients were inserted correctly with the default list_id
      const ingredients = await db.getAllAsync<{
        id: string
        name: string
        completed: number
        list_id: string
      }>("SELECT id, name, completed, list_id FROM ingredients ORDER BY id")

      expect(ingredients.length).toBe(2)
      expect(ingredients[0].id).toBe("1")
      expect(ingredients[0].name).toBe("Salt")
      expect(ingredients[0].completed).toBe(0)
      expect(ingredients[0].list_id).toBe(defaultListId)
      expect(ingredients[1].id).toBe("2")
      expect(ingredients[1].name).toBe("Pepper")
      expect(ingredients[1].completed).toBe(1)
      expect(ingredients[1].list_id).toBe(defaultListId)
    })

    it("should fill in missing timestamps with current time", async () => {
      // Mock ingredient with missing timestamps
      const mockIngredients: Partial<Ingredient>[] = [
        { id: "3", name: "Sugar", completed: false, list_id: "list-1" },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      const beforeTest = Date.now()
      const result = await migrateFromAsyncStorage(db, defaultListId)
      const afterTest = Date.now()

      expect(result.success).toBe(true)

      // Verify timestamps were added
      const ingredient = await db.getFirstAsync<Ingredient>(
        "SELECT * FROM ingredients WHERE id = ?",
        "3"
      )

      expect(ingredient).not.toBeNull()
      expect(ingredient?.created_at).toBeGreaterThanOrEqual(beforeTest)
      expect(ingredient?.created_at).toBeLessThanOrEqual(afterTest)
      expect(ingredient?.updated_at).toBeGreaterThanOrEqual(beforeTest)
      expect(ingredient?.updated_at).toBeLessThanOrEqual(afterTest)
    })

    it("should return failure when error occurs during migration", async () => {
      const mockIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Salt",
          completed: false,
          list_id: "list-1",
          created_at: 1000,
          updated_at: 1000,
        },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      // Mock database error
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Database transaction failed")
      })

      const result = await migrateFromAsyncStorage(db, defaultListId)

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
      expect(result.getError().message).toContain(
        "Failed to migrate data from AsyncStorage"
      )
    })
  })

  describe("Migration to version 2 - Ingredient Lists", () => {
    beforeEach(async () => {
      // Clear any existing tables first
      await db.execAsync(`
        DROP TABLE IF EXISTS ingredient_lists;
        DROP TABLE IF EXISTS ingredients;
        DROP TABLE IF EXISTS database_version;
      `)

      // Set up version 1 schema
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ingredients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
        
        INSERT INTO database_version (version, migration_date) VALUES (1, ${Date.now()});
      `)

      // Insert some test ingredients
      await db.execAsync(`
        INSERT INTO ingredients (id, name, completed, created_at, updated_at) VALUES
        ('ing-1', 'Milk', 0, 1000, 1000),
        ('ing-2', 'Eggs', 0, 2000, 2000),
        ('ing-3', 'Bread', 1, 3000, 3000);
      `)
    })

    it("should create ingredient_lists table", async () => {
      // Import and run migration to version 2
      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(true)

      // Verify table was created
      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='ingredient_lists';`
      )
      expect(tables.length).toBe(1)
    })

    it("should add list_id column to ingredients table", async () => {
      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(true)

      // Verify column was added by checking table schema
      const tableInfo = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(ingredients);`
      )
      const hasListId = tableInfo.some((col) => col.name === "list_id")
      expect(hasListId).toBe(true)
    })

    it("should create a default 'Standard List' and assign all ingredients to it", async () => {
      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(true)

      // Verify default list was created
      const lists = await db.getAllAsync<{ id: string; name: string }>(
        `SELECT id, name FROM ingredient_lists;`
      )
      expect(lists.length).toBe(1)
      expect(lists[0].name).toBe("Standard List")

      const defaultListId = lists[0].id

      // Verify all ingredients have the default list_id
      const ingredients = await db.getAllAsync<{ id: string; list_id: string }>(
        `SELECT id, list_id FROM ingredients;`
      )
      expect(ingredients.length).toBe(3)
      expect(ingredients.every((ing) => ing.list_id === defaultListId)).toBe(
        true
      )
    })

    it("should update database version to 2", async () => {
      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(true)

      // Verify version was updated
      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = 2;`
      )
      expect(version?.version).toBe(2)
    })

    it("should handle migration errors gracefully", async () => {
      // Mock database error
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Migration failed")
      })

      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
    })

    it("should preserve existing ingredient data during migration", async () => {
      const { migrateToVersion2 } = jest.requireActual("../migrations")
      const result = await migrateToVersion2(db)

      expect(result.success).toBe(true)

      // Verify all original data is preserved
      const ingredients = await db.getAllAsync<{
        id: string
        name: string
        completed: number
        created_at: number
        updated_at: number
      }>(
        `SELECT id, name, completed, created_at, updated_at FROM ingredients ORDER BY id;`
      )

      expect(ingredients.length).toBe(3)
      expect(ingredients[0]).toMatchObject({
        id: "ing-1",
        name: "Milk",
        completed: 0,
        created_at: 1000,
        updated_at: 1000,
      })
      expect(ingredients[1]).toMatchObject({
        id: "ing-2",
        name: "Eggs",
        completed: 0,
        created_at: 2000,
        updated_at: 2000,
      })
      expect(ingredients[2]).toMatchObject({
        id: "ing-3",
        name: "Bread",
        completed: 1,
        created_at: 3000,
        updated_at: 3000,
      })
    })
  })
})
