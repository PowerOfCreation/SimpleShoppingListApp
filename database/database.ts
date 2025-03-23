import * as SQLite from "expo-sqlite"

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
 * Initialize database and run migrations if needed
 */
export async function initializeDatabase(
  db: SQLite.SQLiteDatabase
): Promise<{ isFirstRun: boolean }> {
  const database = db
  let isFirstRun = false

  // Check if database_version table exists
  try {
    const result = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='database_version';`
    )
    isFirstRun = result.length === 0
  } catch (error) {
    console.error("Error checking database version table:", error)
    isFirstRun = true
  }

  // Migrations will be handled by the caller to avoid circular dependencies
  // The executeMigrations function from migrations.ts should be called after this

  return { isFirstRun }
}

/**
 * Get current database version
 */
export async function getDatabaseVersion(
  db?: SQLite.SQLiteDatabase
): Promise<number> {
  const database = db || getDatabase()

  try {
    // First check if the table exists
    const tableExists = await database.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='database_version';`
    )

    if (!tableExists || tableExists.cnt === 0) {
      return 0
    }

    const result = await database.getFirstAsync<{ version: number }>(
      `SELECT version FROM database_version ORDER BY version DESC LIMIT 1;`
    )
    return result ? result.version : 0
  } catch (error) {
    console.error("Error getting database version:", error)
    return 0
  }
}

/**
 * Update database version
 */
export async function updateDatabaseVersion(
  version: number,
  db: SQLite.SQLiteDatabase
): Promise<void> {
  const database = db
  const migrationDate = Date.now()

  try {
    // First check if the table exists
    const tableExists = await database.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='database_version';`
    )

    if (!tableExists || tableExists.cnt === 0) {
      // Create the table if it doesn't exist
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS database_version (
          version INTEGER PRIMARY KEY,
          migration_date INTEGER NOT NULL
        );
      `)
    }

    await database.runAsync(
      `INSERT INTO database_version (version, migration_date) VALUES (?, ?);`,
      version,
      migrationDate
    )
  } catch (error) {
    console.error("Error updating database version:", error)
    throw error
  }
}
