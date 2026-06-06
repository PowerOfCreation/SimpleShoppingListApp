import {
  getDatabase,
  getDatabaseVersion,
  updateDatabaseVersion,
  DB_VERSION,
} from "../database"
import * as SQLite from "expo-sqlite"
import * as databaseModule from "../database"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("Database Module", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    // Get a fresh database connection for each test
    db = getDatabase()

    // Clear any existing tables and ensure database_version exists for most tests
    await db.execAsync(`
      DROP TABLE IF EXISTS database_version;
      CREATE TABLE database_version (
        version INTEGER PRIMARY KEY,
        migration_date INTEGER NOT NULL
      );
    `)
  })

  describe("getDatabase", () => {
    it("should get a database connection with the correct name", () => {
      const dbConnection = getDatabase()
      expect(dbConnection).toBeTruthy()
    })
  })

  describe("getDatabaseVersion", () => {
    it("should return the current database version", async () => {
      // Table created in beforeEach, just insert data
      await db.execAsync(`
        INSERT INTO database_version (version, migration_date) VALUES (${DB_VERSION}, ${Date.now()});
      `)

      const result = await getDatabaseVersion(db)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBe(DB_VERSION)
    })

    it("should return 0 when no version is found", async () => {
      // Table is created empty in beforeEach
      const result = await getDatabaseVersion(db)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBe(0)
    })

    it("should return 0 when database_version table does not exist", async () => {
      // Explicitly drop the table created in beforeEach
      await db.execAsync(`DROP TABLE IF EXISTS database_version;`)
      const result = await getDatabaseVersion(db)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBe(0)
    })
  })

  describe("updateDatabaseVersion", () => {
    it("should insert a new database version record", async () => {
      // Table is created in beforeEach
      const result = await updateDatabaseVersion(DB_VERSION, db)
      expect(result.success).toBe(true)

      // Verify the version was inserted
      const dbResult = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?`,
        DB_VERSION
      )

      expect(dbResult && dbResult.version).toBe(DB_VERSION)
    })

    it("should create the table if it doesn't exist", async () => {
      // Drop the table first to test creation logic
      await db.execAsync(`DROP TABLE IF EXISTS database_version;`)
      const result = await updateDatabaseVersion(DB_VERSION, db)
      expect(result.success).toBe(true)

      // Check if the table exists now
      const tableExists = await db.getFirstAsync<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='database_version';`
      )

      expect(tableExists && tableExists.cnt).toBe(1)

      // Verify the version was inserted
      const dbResult = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?`,
        DB_VERSION
      )

      expect(dbResult && dbResult.version).toBe(DB_VERSION)
    })

    it("should handle database errors properly", async () => {
      // Table is created in beforeEach
      // Mock updateDatabaseVersion to force an error
      jest
        .spyOn(databaseModule, "updateDatabaseVersion")
        .mockImplementationOnce(
          async (): Promise<Result<void, DbMigrationError>> => {
            return Result.fail(
              new DbMigrationError("Mock error", DB_VERSION, new Error())
            )
          }
        )

      const result = await updateDatabaseVersion(DB_VERSION, db)
      expect(result.success).toBe(false)
      expect(result.getError()).toBeTruthy()
    })
  })
})
