import * as SQLite from "expo-sqlite"
import { executeMigrations } from "../migrations"
import { getDatabase, DB_VERSION } from "../database"
import { DbMigrationError } from "@/api/common/error-types"
import { Ingredient } from "../../types/Ingredient"
import { getItem } from "../../api/common/async-storage"

// Import the createTables function directly from migrations
const { createTables, migrateFromAsyncStorage } =
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
    `)
  })

  describe("executeMigrations", () => {
    it("should create database tables on first run", async () => {
      // Test as if it's the first run
      const result = await executeMigrations(db, true)
      expect(result.success).toBe(true)

      // Verify tables were created
      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND (name='ingredients' OR name='database_version');`
      )
      expect(tables.length).toBe(2)
      expect(tables.some((t) => t.name === "ingredients")).toBe(true)
      expect(tables.some((t) => t.name === "database_version")).toBe(true)

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

      const result = await executeMigrations(db, true)

      // Should fail with proper error type
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
    })

    it("should update database version after successful migration", async () => {
      const result = await executeMigrations(db, false)
      expect(result.success).toBe(true)

      // Check version was updated
      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?;`,
        DB_VERSION
      )
      expect(version && version.version).toBe(DB_VERSION)
    })
  })

  describe("migrateFromAsyncStorage", () => {
    beforeEach(async () => {
      // Reset mocks before each test
      jest.clearAllMocks()
      jest.mocked(getItem).mockResolvedValue(null)

      // Use the actual createTables function to set up the database structure
      const tablesResult = await createTables(db)
      expect(tablesResult.success).toBe(true)
    })

    it("should handle empty ingredients array gracefully", async () => {
      jest.mocked(getItem).mockResolvedValueOnce([])

      const result = await migrateFromAsyncStorage(db)

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
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "2",
          name: "Pepper",
          completed: true,
          created_at: 2000,
          updated_at: 2000,
        },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      const result = await migrateFromAsyncStorage(db)

      expect(result.success).toBe(true)

      // Verify ingredients were inserted correctly
      const ingredients = await db.getAllAsync<Ingredient>(
        "SELECT id, name, completed, created_at, updated_at FROM ingredients ORDER BY id"
      )

      expect(ingredients.length).toBe(2)
      expect(ingredients[0].id).toBe("1")
      expect(ingredients[0].name).toBe("Salt")
      expect(ingredients[0].completed).toBe(0)
      expect(ingredients[1].id).toBe("2")
      expect(ingredients[1].name).toBe("Pepper")
      expect(ingredients[1].completed).toBe(1)
    })

    it("should fill in missing timestamps with current time", async () => {
      // Mock ingredient with missing timestamps
      const mockIngredients: Partial<Ingredient>[] = [
        { id: "3", name: "Sugar", completed: false },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      const beforeTest = Date.now()
      const result = await migrateFromAsyncStorage(db)
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
          created_at: 1000,
          updated_at: 1000,
        },
      ]

      jest.mocked(getItem).mockResolvedValueOnce(mockIngredients)

      // Mock database error
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Database transaction failed")
      })

      const result = await migrateFromAsyncStorage(db)

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
      expect(result.getError().message).toContain(
        "Failed to migrate data from AsyncStorage"
      )
    })
  })
})
