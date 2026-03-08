import { BaseRepository } from "../base-repository"
import * as SQLite from "expo-sqlite"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

// Mock the logger
jest.mock("@/api/common/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}))

// Mock DB_NAME without breaking function exports
jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

/**
 * Test implementation of BaseRepository for retry logic testing
 */
class TestRepository extends BaseRepository {
  protected readonly entityName = "TestEntity"

  constructor(db: SQLite.SQLiteDatabase) {
    super(db, "TestRepository")
  }

  // Expose protected method for testing
  async executeQueryWithRetry<T>(
    queryFn: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3
  ): Promise<Result<T, DbQueryError>> {
    return this._executeQueryWithRetry(queryFn, operationName, maxRetries)
  }

  // Expose protected method for testing
  async executeQuery<T>(
    queryFn: () => Promise<T>,
    operationName: string
  ): Promise<Result<T, DbQueryError>> {
    return this._executeQuery(queryFn, operationName)
  }
}

describe("BaseRepository Retry Logic", () => {
  let db: SQLite.SQLiteDatabase
  let repository: TestRepository

  beforeEach(() => {
    db = {
      execAsync: jest.fn(),
      runAsync: jest.fn(),
      getAllAsync: jest.fn(),
      getFirstAsync: jest.fn(),
      withTransactionAsync: jest.fn(),
    } as unknown as SQLite.SQLiteDatabase

    repository = new TestRepository(db)
  })

  describe("_executeQueryWithRetry", () => {
    it("should return success on first successful attempt", async () => {
      const mockFn = jest.fn().mockResolvedValueOnce("success")

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation"
      )

      expect(result.success).toBe(true)
      expect(result.getValue()).toBe("success")
      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it("should retry on SQLITE_BUSY error and eventually succeed", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("database is locked"))
        .mockRejectedValueOnce(new Error("database is locked"))
        .mockResolvedValueOnce("success")

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation",
        3
      )

      expect(result.success).toBe(true)
      expect(result.getValue()).toBe("success")
      expect(mockFn).toHaveBeenCalledTimes(3)
    })

    it("should fail after max retries exceeded", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValue(new Error("database is locked"))

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation",
        2
      )

      expect(result.success).toBe(false)
      expect(mockFn).toHaveBeenCalledTimes(2)
    })

    it("should fail immediately on non-database-locked errors", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("constraint failed"))

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation",
        3
      )

      expect(result.success).toBe(false)
      // Should fail immediately without retries
      expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it("should respect maxRetries parameter", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValue(new Error("database is locked"))

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation",
        5
      )

      expect(result.success).toBe(false)
      expect(mockFn).toHaveBeenCalledTimes(5)
    })

    it("should include error message in failure result", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValue(new Error("database is locked"))

      const result = await repository.executeQueryWithRetry(
        mockFn,
        "testOperation",
        1
      )

      expect(result.success).toBe(false)
      const error = result.getError()
      expect(error).toBeDefined()
      expect(error?.message).toContain("Failed to")
    })
  })

  describe("_executeQuery (without retry)", () => {
    it("should execute query and return success", async () => {
      const mockFn = jest.fn().mockResolvedValueOnce("test_data")

      const result = await repository.executeQuery(mockFn, "testOperation")

      expect(result.success).toBe(true)
      expect(result.getValue()).toBe("test_data")
    })

    it("should return failure on first error without retry", async () => {
      const mockFn = jest.fn().mockRejectedValueOnce(new Error("some error"))

      const result = await repository.executeQuery(mockFn, "testOperation")

      expect(result.success).toBe(false)
      expect(mockFn).toHaveBeenCalledTimes(1)
    })
  })
})
