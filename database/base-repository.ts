import * as SQLite from "expo-sqlite"
import { createLogger, Logger } from "@/api/common/logger"
import { DbQueryError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

/**
 * Base class for database repositories.
 * Handles common tasks like database connection, logging, and error handling.
 */
export abstract class BaseRepository {
  protected readonly db: SQLite.SQLiteDatabase
  protected readonly logger: Logger
  protected abstract readonly entityName: string

  /**
   * Creates an instance of BaseRepository.
   * @param db The SQLite database connection instance.
   * @param repositoryName The name of the repository (used for logging).
   */
  constructor(db: SQLite.SQLiteDatabase, repositoryName: string) {
    this.db = db
    this.logger = createLogger(repositoryName)
  }

  /**
   * Executes a database query function with standardized error handling and result wrapping.
   * @param queryFn A function that performs the database operation and returns a promise with the result.
   * @param operationName The name of the operation being performed (e.g., "getAll", "add").
   * @returns A Promise resolving to a Result object containing the query result or a DbQueryError.
   */
  protected async _executeQuery<T>(
    queryFn: () => Promise<T>,
    operationName: string
  ): Promise<Result<T, DbQueryError>> {
    try {
      const data = await queryFn()
      return Result.ok(data)
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to ${operationName} ${this.entityName}(s)`,
        operationName,
        this.entityName,
        error
      )
      this.logger.error(
        `Error during ${operationName} ${this.entityName}(s)`,
        dbError
      )
      return Result.fail(dbError)
    }
  }

  /**
   * Executes a database write operation within a transaction.
   * Handles standardized error handling and result wrapping for transactional writes.
   * @param queryFn A function that performs the database write operation(s).
   * @param operationName The name of the operation being performed (e.g., "add", "update").
   * @returns A Promise resolving to a Result object containing void or a DbQueryError.
   */
  protected async _executeTransaction(
    queryFn: () => Promise<void>,
    operationName: string
  ): Promise<Result<void, DbQueryError>> {
    try {
      // Wrap the core logic in a transaction
      await this.db.withTransactionAsync(queryFn)
      return Result.ok(undefined) // Indicate success with void
    } catch (error) {
      const dbError = new DbQueryError(
        `Failed to ${operationName} ${this.entityName}(s)`,
        operationName,
        this.entityName,
        error
      )
      this.logger.error(
        `Error during transactional ${operationName} ${this.entityName}(s)`,
        dbError
      )
      return Result.fail(dbError)
    }
  }
}
