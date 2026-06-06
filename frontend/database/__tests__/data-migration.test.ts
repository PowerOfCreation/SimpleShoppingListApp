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

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
    getDatabaseVersion: jest.fn(),
  }
})

jest.mock("../migrations", () => ({
  executeMigrations: jest.fn(),
}))

describe("Data Migration", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    jest.clearAllMocks()

    db = database.getDatabase()

    try {
      await db.execAsync(`DROP TABLE IF EXISTS database_version;`)
    } catch (e) {
      console.warn("Database cleanup error:", e)
    }

    const getVersionMock = database.getDatabaseVersion as jest.Mock
    getVersionMock.mockResolvedValue(Result.ok(0))

    const migrationsMock = migrations.executeMigrations as jest.Mock
    migrationsMock.mockResolvedValue(Result.ok(undefined))
  })

  describe("initializeAndMigrateDatabase", () => {
    it("should run migrations on a fresh install (currentVersion = 0)", async () => {
      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(database.getDatabaseVersion).toHaveBeenCalledWith(db)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, 0)
    })

    it("should run migrations when database version is outdated", async () => {
      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(0))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, 0)
    })

    it("should skip migrations when database is already at DB_VERSION", async () => {
      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(database.DB_VERSION))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(migrations.executeMigrations).not.toHaveBeenCalled()
    })

    it("should run migrations for legacy devices (currentVersion > DB_VERSION)", async () => {
      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.ok(6))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(true)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, 6)
    })

    it("should handle version check failure", async () => {
      const underlyingError = new Error("Mock version check error")
      const getVersionDbError = new DbQueryError(
        "Failed to get database version",
        "getDatabaseVersion",
        "database_version",
        underlyingError
      )

      const getVersionMock = database.getDatabaseVersion as jest.Mock
      getVersionMock.mockResolvedValue(Result.fail(getVersionDbError))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(false)
      expect(migrations.executeMigrations).not.toHaveBeenCalled()

      const error = result.getError()
      expect(error).toBeInstanceOf(DbConnectionError)
    })

    it("should handle migration failure", async () => {
      const migrationErrorCause = new Error("Mock migration execution error")
      const expectedDbError = new DbMigrationError(
        "Failed to execute migrations during test",
        1,
        migrationErrorCause
      )

      const migrationsMock = migrations.executeMigrations as jest.Mock
      migrationsMock.mockResolvedValue(Result.fail(expectedDbError))

      const result = await initializeAndMigrateDatabase(db)

      expect(result.success).toBe(false)
      expect(migrations.executeMigrations).toHaveBeenCalledWith(db, 0)

      const error = result.getError()
      expect(error).toBeInstanceOf(DbMigrationError)
      expect(error).toBe(expectedDbError)
    })
  })
})
