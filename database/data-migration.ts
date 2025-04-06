import {
  checkDatabaseInitialized,
  getDatabaseVersion,
  DB_VERSION,
} from "./database"
import { executeMigrations } from "./migrations"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbConnectionError, DbMigrationError } from "@/api/common/error-types"
import * as SQLite from "expo-sqlite"

const logger = createLogger("DataMigration")

/**
 * Initialize database, create tables, and migrate data if needed
 * This function ensures the database is ready for use.
 * @param db The SQLite database instance to use.
 * @returns Result containing void on success or error on failure
 */
export async function initializeAndMigrateDatabase(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbConnectionError | DbMigrationError>> {
  try {
    // Check if this is the first run (meaning tables might not exist)
    const initResult = await checkDatabaseInitialized(db)

    if (!initResult.success) {
      // Return the init error directly
      return Result.fail(initResult.getError()!)
    }

    const initData = initResult.getValue()
    // initData is guaranteed to be non-null when success is true
    const isFirstRun = initData!.isFirstRun

    // Check the current schema version stored in the database
    const versionResult = await getDatabaseVersion(db)

    if (!versionResult.success) {
      return Result.fail(
        new DbConnectionError(
          "Failed to get database version",
          versionResult.getError()
        )
      )
    }

    const currentVersion = versionResult.getValue() || 0

    // Only execute migrations if it's the first run OR the DB version is outdated
    if (isFirstRun || currentVersion < DB_VERSION) {
      // Pass the actual isFirstRun flag to potentially trigger AsyncStorage migration
      const migrateResult = await executeMigrations(db, isFirstRun)

      if (!migrateResult.success) {
        return migrateResult
      }

      logger.info(
        `Database initialized/migrated successfully. First run: ${isFirstRun}, DB Version: ${DB_VERSION}`
      )
    } else {
      logger.info(
        `Database already initialized with current version ${currentVersion}`
      )
    }

    return Result.ok(undefined)
  } catch (error) {
    const dbError = new DbConnectionError(
      "Failed to initialize database",
      error
    )
    logger.error("Database initialization failed", dbError)
    return Result.fail(dbError)
  }
}
