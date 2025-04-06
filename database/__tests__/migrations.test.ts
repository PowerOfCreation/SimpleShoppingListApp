import * as SQLite from "expo-sqlite"
import { executeMigrations } from "../migrations"
import { getDatabase, DB_VERSION } from "../database"
import { DbMigrationError } from "@/api/common/error-types"

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
})
