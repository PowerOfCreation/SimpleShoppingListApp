import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { DbQueryError, DbMigrationError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

const logger = createLogger("Database")

/**
 * Database version number - increment this when schema changes
 */
export const DB_VERSION = 2

/**
 * Database file name
 */
export const DB_NAME = "sholist.db"

/**
 * Singleton instance of the database connection
 */
let dbInstance: SQLite.SQLiteDatabase | null = null

/**
 * Get SQLite database connection (singleton pattern)
 * Returns the same instance on every call to prevent connection pool exhaustion
 * and database lock contention during hot reloads.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync(DB_NAME)
  }
  return dbInstance
}

/**
 * Reset the database singleton instance.
 * Used for testing and lifecycle management (e.g., app going to background).
 */
export function resetDatabase(): void {
  dbInstance = null
}

/**
 * Get current database version
 */
export async function getDatabaseVersion(
  db?: SQLite.SQLiteDatabase
): Promise<Result<number, DbQueryError>> {
  const database = db || getDatabase()

  try {
    // First check if the table exists
    const tableExists = await database.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='database_version';`
    )

    if (!tableExists || tableExists.cnt === 0) {
      return Result.ok(0)
    }

    const result = await database.getFirstAsync<{ version: number }>(
      `SELECT version FROM database_version ORDER BY version DESC LIMIT 1;`
    )
    return Result.ok(result ? result.version : 0)
  } catch (error) {
    const dbError = new DbQueryError(
      "Failed to get database version",
      "getDatabaseVersion",
      "database_version",
      error
    )
    logger.error("Error getting database version", dbError)
    return Result.fail(dbError)
  }
}

/**
 * Update database version
 */
export async function updateDatabaseVersion(
  version: number,
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  const migrationDate = Date.now()

  try {
    // First check if the table exists
    const tableExists = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='database_version';`
    )

    if (!tableExists || tableExists.cnt === 0) {
      // Create the table if it doesn't exist
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
      `)
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO database_version (version, migration_date) VALUES (?, ?);`,
      version,
      migrationDate
    )

    return Result.ok(undefined)
  } catch (error) {
    const dbError = new DbMigrationError(
      "Failed to update database version",
      version,
      error
    )
    logger.error("Error updating database version", dbError)
    return Result.fail(dbError)
  }
}
