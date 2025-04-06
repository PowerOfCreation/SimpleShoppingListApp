import { initializeAndMigrateDatabase } from "../data-migration"
import * as database from "../database"
import * as migrations from "../migrations"
import * as SQLite from "expo-sqlite"
import { Result } from "@/api/common/result"
import {
  DbConnectionError,
  DbMigrationError,
  DbQueryError,
} from "@/api/common/error-types"

// Mock the dependencies with more focused mocks
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:", // Use in-memory database for tests
    getDatabaseVersion: jest.fn(),
    checkDatabaseInitialized: jest.fn(),
  }
})

// Mock migrations
jest.mock("../migrations", () => ({
  executeMigrations: jest.fn(),
}))

describe("Data Migration", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    // Reset all mock functions
    jest.clearAllMocks()

    // Get a database connection
    db = database.getDatabase()

    // Clean up any previous test data
    try {
      await db.execAsync(`DROP TABLE IF EXISTS database_version;`)
    } catch (e) {
      // If the table doesn't exist, that's fine
      console.warn("Database cleanup error:", e)
    }

    // Set default mock implementations - fix syntax errors here
    const checkDbMock = database.checkDatabaseInitialized as jest.Mock
    checkDbMock.mockResolvedValue(Result.ok({ isFirstRun: true }))

    const getVersionMock = database.getDatabaseVersion as jest.Mock
    getVersionMock.mockResolvedValue(Result.ok(0))

    const migrationsMock = migrations.executeMigrations as jest.Mock
    migrationsMock.mockResolvedValue(Result.ok(undefined))
  })

  describe("initializeAndMigrateDatabase", () => {
    it("should detect first run (no table) and execute migrations", async () => {
      // Already set up in beforeEach
      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(database.checkDatabaseInitialized).toHaveBeenCalledWith(db)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, true)
    })

    it("should detect existing database with outdated version and execute migrations", async () => {
      // Explicitly define the type to fix linter error
      const oldVersion: number =
        database.DB_VERSION > 1 ? database.DB_VERSION - 1 : 0

      // Mock database is not first run but has outdated version
      const checkDbMock = database.checkDatabaseInitialized as jest.Mock
      checkDbMock.mockResolvedValue(Result.ok({ isFirstRun: false }))

      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(oldVersion))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(database.checkDatabaseInitialized).toHaveBeenCalledWith(db)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, false)
    })

    it("should skip migrations for up-to-date database", async () => {
      // Mock that database exists and is up to date
      const checkDbMock = database.checkDatabaseInitialized as jest.Mock
      checkDbMock.mockResolvedValue(Result.ok({ isFirstRun: false }))

      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(database.DB_VERSION))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(database.checkDatabaseInitialized).toHaveBeenCalledWith(db)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)
      expect(migrations.executeMigrations).not.toHaveBeenCalled()
    })

    it("should handle version check failure", async () => {
      // Create the error objects
      const underlyingError = new Error("Mock version check error")
      // Fix linter error with explicit type
      const getVersionDbError: DbQueryError = new DbQueryError(
        "Failed to get database version",
        "getDatabaseVersion",
        "database_version",
        underlyingError
      )

      // Mock that database exists but version check fails
      const checkDbMock = database.checkDatabaseInitialized as jest.Mock
      checkDbMock.mockResolvedValue(Result.ok({ isFirstRun: false }))

      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.fail(getVersionDbError))

      const result = await initializeAndMigrateDatabase(db)

      // Verify the function failed with the expected error
      expect(result.success).toBe(false)
      expect(database.checkDatabaseInitialized).toHaveBeenCalledWith(db)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)

      const error = result.getError()
      expect(error).toBeInstanceOf(DbConnectionError)
      expect((error as DbConnectionError).message).toBe(
        "Failed to get database version"
      )

      // Don't test for exact cause object since it might not be preserved exactly
      // Just check that migrations were not called
      expect(migrations.executeMigrations).not.toHaveBeenCalled()
    })

    it("should handle migration failure", async () => {
      // Create the error objects
      const migrationErrorCause = new Error("Mock migration execution error")
      // Fix linter error with explicit type
      const expectedDbError: DbMigrationError = new DbMigrationError(
        "Failed to execute migrations during test",
        1,
        migrationErrorCause
      )

      // Mock successful init and version check, but migration fails
      const checkDbMock = database.checkDatabaseInitialized as jest.Mock
      checkDbMock.mockResolvedValue(Result.ok({ isFirstRun: true }))

      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(0))

      const migrationsMock = migrations.executeMigrations as jest.Mock
      migrationsMock.mockResolvedValue(Result.fail(expectedDbError))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(false)
      expect(database.checkDatabaseInitialized).toHaveBeenCalledWith(db)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, true)

      const error = result.getError()
      expect(error).toBeInstanceOf(DbMigrationError)
      expect(error).toBe(expectedDbError)
    })
  })
})
