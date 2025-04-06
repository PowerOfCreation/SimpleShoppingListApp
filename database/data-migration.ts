import {
  getDatabase,
  initializeDatabase,
  getDatabaseVersion,
  DB_VERSION,
} from "./database"
import { executeMigrations } from "./migrations"

/**
 * Initialize database, create tables, and migrate data if needed
 * This function ensures the database is ready for use.
 * @returns Promise that resolves when initialization and migration are complete
 */
export async function initializeAndMigrateDatabase(): Promise<void> {
  try {
    // Get database connection
    const db = getDatabase()

    // Check if this is the first run (meaning tables might not exist)
    const { isFirstRun } = await initializeDatabase(db)

    // Check the current schema version stored in the database
    const currentVersion = await getDatabaseVersion(db)

    // Only execute migrations if it's the first run OR the DB version is outdated
    if (isFirstRun || currentVersion < DB_VERSION) {
      // Pass the actual isFirstRun flag to potentially trigger AsyncStorage migration
      await executeMigrations(db, isFirstRun)
      console.log(
        `Database initialized/migrated successfully. First run: ${isFirstRun}, DB Version: ${DB_VERSION}`
      )
    } else {
      console.log(
        `Database already initialized with current version ${currentVersion}`
      )
    }
  } catch (error) {
    console.error("Database initialization failed:", error)
    throw new Error(`Failed to initialize database: ${error}`)
  }
}
