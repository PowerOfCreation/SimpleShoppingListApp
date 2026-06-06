import { getDatabaseVersion, DB_VERSION } from "./database"
import { executeMigrations } from "./migrations"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbConnectionError, DbMigrationError } from "@/api/common/error-types"
import * as SQLite from "expo-sqlite"

const logger = createLogger("DataMigration")

/**
 * Initialize database and run any pending migrations.
 * @param db The SQLite database instance to use.
 * @returns Result containing void on success or error on failure
 */
export async function initializeAndMigrateDatabase(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbConnectionError | DbMigrationError>> {
  try {
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

    // Also runs when currentVersion > DB_VERSION to handle legacy version numbering reset
    if (currentVersion !== DB_VERSION) {
      const migrateResult = await executeMigrations(db, currentVersion)

      if (!migrateResult.success) {
        return migrateResult
      }

      logger.info(
        `Database initialized/migrated successfully. DB Version: ${DB_VERSION}`
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
