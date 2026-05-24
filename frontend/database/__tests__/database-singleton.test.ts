import { getDatabase, resetDatabase } from "../database"

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("Database Singleton Pattern", () => {
  afterEach(() => {
    // Reset the singleton after each test
    resetDatabase()
  })

  describe("getDatabase singleton behavior", () => {
    it("should return the same database instance on multiple calls", () => {
      const db1 = getDatabase()
      const db2 = getDatabase()
      const db3 = getDatabase()

      // All should be the same instance (not just equal, but the same object)
      expect(db1).toBe(db2)
      expect(db2).toBe(db3)
    })

    it("should return different instances after resetDatabase() is called", () => {
      const db1 = getDatabase()
      resetDatabase()
      const db2 = getDatabase()

      // They should be different instances
      expect(db1).not.toBe(db2)
    })

    it("should create a new instance after reset and subsequent calls should return the same instance", () => {
      const db1 = getDatabase()
      resetDatabase()
      const db2 = getDatabase()
      const db3 = getDatabase()

      expect(db2).toBe(db3)
      expect(db1).not.toBe(db2)
    })

    it("should properly maintain database state across singleton calls", async () => {
      const db = getDatabase()

      // Create a test table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY,
          value TEXT
        );
      `)

      // Insert data
      await db.runAsync(
        "INSERT INTO test_table (value) VALUES (?)",
        "test_value"
      )

      // Get the database again (should be same instance)
      const db2 = getDatabase()
      const result = await db2.getAllAsync<{ value: string }>(
        "SELECT value FROM test_table"
      )

      // Should be able to access the data inserted via the first reference
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe("test_value")
    })

    it("should provide a real SQLiteDatabase instance", () => {
      const db = getDatabase()

      // Check that it has the expected methods
      expect(db).toHaveProperty("execAsync")
      expect(db).toHaveProperty("runAsync")
      expect(db).toHaveProperty("getAllAsync")
      expect(db).toHaveProperty("getFirstAsync")
      expect(db).toHaveProperty("withTransactionAsync")
    })
  })

  describe("resetDatabase function", () => {
    it("should allow resetting the singleton", () => {
      const db1 = getDatabase()
      expect(db1).toBeTruthy()

      resetDatabase()

      const db2 = getDatabase()
      expect(db1).not.toBe(db2)
    })

    it("should be callable multiple times without error", () => {
      expect(() => {
        resetDatabase()
        resetDatabase()
        resetDatabase()
      }).not.toThrow()
    })
  })
})
