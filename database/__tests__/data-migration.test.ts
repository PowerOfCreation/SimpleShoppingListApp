import { initializeAndMigrateDatabase } from "../data-migration"
import { getDatabase } from "../database"
import { executeMigrations } from "../migrations"
import * as SQLite from "expo-sqlite"

// Mock dependencies
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    initializeDatabase: jest.fn(),
    getDatabase: jest.fn(),
    getDatabaseVersion: jest.fn(),
    DB_NAME: ":memory:",
    DB_VERSION: 1,
  }
})

jest.mock("../migrations", () => ({
  executeMigrations: jest.fn(),
}))

describe("Data Migration Module", () => {
  // Create a partial mock of SQLiteDatabase with just the methods we use
  const mockDb = {
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    withTransactionAsync: jest.fn(),
  } as unknown as SQLite.SQLiteDatabase

  // Get mocked functions from jest directly
  const mockInitializeDatabase = jest.fn()
  const mockGetDatabaseVersion = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDatabase as jest.Mock).mockReturnValue(mockDb)
    ;(executeMigrations as jest.Mock).mockResolvedValue(undefined)

    // Reset our mocked functions for each test
    mockInitializeDatabase.mockReset()
    mockGetDatabaseVersion.mockReset()

    // Set up mocks using Jest's spyOn
    jest
      .spyOn(jest.requireMock("../database"), "initializeDatabase")
      .mockImplementation(mockInitializeDatabase)
    jest
      .spyOn(jest.requireMock("../database"), "getDatabaseVersion")
      .mockImplementation(mockGetDatabaseVersion)
  })

  describe("initializeAndMigrateDatabase", () => {
    it("should initialize database and attempt migration on first run", async () => {
      // Mock initializeDatabase to return isFirstRun = true
      mockInitializeDatabase.mockResolvedValue({ isFirstRun: true })

      // Mock current version is 0 (no version yet)
      mockGetDatabaseVersion.mockResolvedValue(0)

      // Call function
      await initializeAndMigrateDatabase()

      // Verify database was initialized
      expect(getDatabase).toHaveBeenCalled()
      expect(mockInitializeDatabase).toHaveBeenCalledWith(mockDb)

      // Verify migrations were executed with isFirstRun = true to attempt AsyncStorage migration
      expect(executeMigrations).toHaveBeenCalledWith(mockDb, true)
    })

    it("should skip migrations if database is already at current version", async () => {
      // Mock initializeDatabase to return isFirstRun = false
      mockInitializeDatabase.mockResolvedValue({ isFirstRun: false })

      // Mock current version is already at DB_VERSION
      mockGetDatabaseVersion.mockResolvedValue(1) // DB_VERSION

      // Call function
      await initializeAndMigrateDatabase()

      // Verify database was initialized
      expect(getDatabase).toHaveBeenCalled()
      expect(mockInitializeDatabase).toHaveBeenCalledWith(mockDb)

      // Verify migrations were NOT executed since we're already at the current version
      expect(executeMigrations).not.toHaveBeenCalled()
    })

    it("should run migrations if database version needs upgrading", async () => {
      // Mock initializeDatabase to return isFirstRun = false
      mockInitializeDatabase.mockResolvedValue({ isFirstRun: false })

      // Mock current version is lower than DB_VERSION
      mockGetDatabaseVersion.mockResolvedValue(0)

      // Call function
      await initializeAndMigrateDatabase()

      // Verify migrations were executed
      expect(executeMigrations).toHaveBeenCalledWith(mockDb, false)
    })

    it("should handle database initialization errors", async () => {
      // Mock error from initializeDatabase
      mockInitializeDatabase.mockRejectedValue(new Error("Test error"))

      // Call function and expect error
      await expect(initializeAndMigrateDatabase()).rejects.toThrow(
        "Failed to initialize database"
      )

      // Verify executeMigrations was not called due to error
      expect(executeMigrations).not.toHaveBeenCalled()
    })

    it("should handle migration errors", async () => {
      // Mock initialization success
      mockInitializeDatabase.mockResolvedValue({ isFirstRun: true })

      // Mock current version
      mockGetDatabaseVersion.mockResolvedValue(0)

      // Mock error from executeMigrations
      ;(executeMigrations as jest.Mock).mockRejectedValue(
        new Error("Migration error")
      )

      // Call function and expect error
      await expect(initializeAndMigrateDatabase()).rejects.toThrow(
        "Failed to initialize database"
      )
    })
  })
})
