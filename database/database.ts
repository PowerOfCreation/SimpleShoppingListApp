import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import {
  DbConnectionError,
  DbQueryError,
  DbMigrationError,
} from "@/api/common/error-types"
import { Result } from "@/api/common/result"

const logger = createLogger("Database")

/**
 * Database version number - increment this when schema changes
 */
export const DB_VERSION = 1

/**
 * Database file name
 */
export const DB_NAME = "sholist.db"

/**
 * Get SQLite database connection
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  return SQLite.openDatabaseSync(DB_NAME)
}

/**
 * Checks if this is the first database initialization by looking for the database_version table
 * @param db SQLite database connection
 * @returns Result containing whether this is the first run
 */
export async function checkDatabaseInitialized(
  db: SQLite.SQLiteDatabase
): Promise<Result<{ isFirstRun: boolean }, DbConnectionError>> {
  try {
    // Check if database_version table exists
    const result = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='database_version';`
    )
    const isFirstRun = result.length === 0
    return Result.ok({ isFirstRun })
  } catch (error) {
    // If we get an error like "no such table: sqlite_master", it's definitely a first run
    // SQLite creates sqlite_master automatically, so if it doesn't exist, the DB is completely new
    logger.info("Error checking database tables, assuming first run", error)
    return Result.ok({ isFirstRun: true })
  }
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
      `INSERT INTO database_version (version, migration_date) VALUES (?, ?);`,
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
