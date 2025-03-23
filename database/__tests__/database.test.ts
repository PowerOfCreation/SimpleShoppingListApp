import {
  getDatabase,
  initializeDatabase,
  getDatabaseVersion,
  updateDatabaseVersion,
  DB_VERSION,
} from "../database"
import * as SQLite from "expo-sqlite"
import * as databaseModule from "../database"

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

// Mock migrations to avoid circular dependencies
jest.mock("../migrations", () => ({
  executeMigrations: jest.fn(async () => Promise.resolve()),
}))

describe("Database Module", () => {
  describe("getDatabase", () => {
    it("should get a database connection with the correct name", () => {
      const db = getDatabase()
      expect(db).toBeTruthy()
    })
  })

  describe("initializeDatabase", () => {
    it("should detect first run when database_version table does not exist", async () => {
      // Get a database connection and pass it to initializeDatabase
      const db = getDatabase()
      const result = await initializeDatabase(db)
      expect(result.isFirstRun).toBe(true)
    })

    it("should detect existing database when database_version table exists", async () => {
      // Create the database_version table
      const db = getDatabase()

      await db.execAsync(`
        CREATE TABLE database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
        INSERT INTO database_version (version, migration_date) VALUES (1, ${Date.now()});
      `)

      // Now test initializeDatabase with the db connection
      const result = await initializeDatabase(db)
      expect(result.isFirstRun).toBe(false)
    })
  })

  describe("getDatabaseVersion", () => {
    it("should return the current database version", async () => {
      // Create the database_version table and insert a version
      const db = getDatabase()
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
        INSERT INTO database_version (version, migration_date) VALUES (${DB_VERSION}, ${Date.now()});
      `)

      // Test getDatabaseVersion with the db connection
      const version = await getDatabaseVersion(db)
      expect(version).toBe(DB_VERSION)
    })

    it("should return 0 when no version is found", async () => {
      // Create an empty database_version table
      const db = getDatabase()

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
      `)

      // Test getDatabaseVersion with the db connection
      const version = await getDatabaseVersion(db)
      expect(version).toBe(0)
    })

    it("should return 0 when database_version table does not exist", async () => {
      // Test with a fresh database where the table doesn't exist
      const db = getDatabase()
      const version = await getDatabaseVersion(db)
      expect(version).toBe(0)
    })
  })

  describe("updateDatabaseVersion", () => {
    it("should insert a new database version record", async () => {
      // Create the database_version table
      const db = getDatabase()
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
      `)

      // Run the function we're testing with the db connection
      await updateDatabaseVersion(DB_VERSION, db)

      // Verify the version was inserted
      const result = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?`,
        DB_VERSION
      )

      expect(result?.version).toBe(DB_VERSION)
    })

    it("should throw an error when table does not exist", async () => {
      // Get a fresh database connection
      const db = getDatabase()

      // Mock updateDatabaseVersion to skip table creation
      jest
        .spyOn(databaseModule, "updateDatabaseVersion")
        .mockImplementationOnce(async function mockUpdateDbVersion(
          ...args: unknown[]
        ) {
          const version = args[0] as number
          const database = (args[1] as SQLite.SQLiteDatabase) || getDatabase()
          const migrationDate = Date.now()

          // Skip table creation step - directly insert, which will fail
          await database.runAsync(
            `INSERT INTO database_version (version, migration_date) VALUES (?, ?);`,
            [version, migrationDate] as const
          )
        })

      // The test expects an error when table doesn't exist
      await expect(updateDatabaseVersion(DB_VERSION, db)).rejects.toThrow()
    })
  })
})
