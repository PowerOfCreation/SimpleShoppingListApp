import { executeMigrations } from "../migrations"
import { getItem } from "../../api/common/async-storage"
import { getDatabase, DB_VERSION } from "../database"

// Mock async-storage
jest.mock("../../api/common/async-storage", () => ({
  getItem: jest.fn(),
}))

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("Migrations Module", () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("executeMigrations", () => {
    it("should create tables for first run", async () => {
      const db = getDatabase()
      // Run migrations
      await executeMigrations(db, true)

      // Verify tables were created
      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ingredients', 'database_version');`
      )

      expect(tables.length).toBe(2)
      expect(tables.some((t) => t.name === "ingredients")).toBe(true)
      expect(tables.some((t) => t.name === "database_version")).toBe(true)

      // Verify version was updated
      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?`,
        DB_VERSION
      )

      expect(version?.version).toBe(DB_VERSION)
    })

    it("should migrate data from AsyncStorage on first run", async () => {
      const db = getDatabase()

      // Mock AsyncStorage data
      const mockIngredients = [
        { id: "1", name: "Milk", completed: false },
        { id: "2", name: "Eggs", completed: true },
      ]
      ;(getItem as jest.Mock).mockResolvedValueOnce(mockIngredients)

      // Run migrations
      await executeMigrations(db, true)

      // Verify ingredients were inserted
      const ingredients = await db.getAllAsync<{
        id: string
        name: string
        completed: number
      }>(`SELECT id, name, completed FROM ingredients ORDER BY id`)

      expect(ingredients.length).toBe(2)
      expect(ingredients[0].id).toBe("1")
      expect(ingredients[0].name).toBe("Milk")
      expect(ingredients[0].completed).toBe(0)
      expect(ingredients[1].id).toBe("2")
      expect(ingredients[1].name).toBe("Eggs")
      expect(ingredients[1].completed).toBe(1)
    })

    it("should skip migration when no ingredients in AsyncStorage", async () => {
      const db = getDatabase()

      // Mock empty AsyncStorage
      ;(getItem as jest.Mock).mockResolvedValueOnce([])

      // Run migrations
      await executeMigrations(db, true)

      // Verify no ingredients were inserted
      const ingredients = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ingredients`
      )

      expect(ingredients.length).toBe(0)
    })

    it("should not migrate data on subsequent runs", async () => {
      const db = getDatabase()

      // Create tables and insert a test ingredient
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
        INSERT INTO ingredients (id, name, completed, created_at, updated_at)
        VALUES ('existing', 'Existing Ingredient', 0, ${Date.now()}, ${Date.now()});
      `)

      // Mock AsyncStorage data that shouldn't be used
      const mockIngredients = [
        {
          id: "should-not-be-added",
          name: "Should Not Be Added",
          completed: false,
        },
      ]
      ;(getItem as jest.Mock).mockResolvedValueOnce(mockIngredients)

      // Run migrations with isFirstRun = false
      await executeMigrations(db, false)

      // Verify only the existing ingredient exists
      const ingredients = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ingredients`
      )

      expect(ingredients.length).toBe(1)
      expect(ingredients[0].id).toBe("existing")
      expect(getItem).not.toHaveBeenCalled()
    })
  })
})
