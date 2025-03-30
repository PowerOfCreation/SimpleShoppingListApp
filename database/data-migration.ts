import {
  getDatabase,
  initializeDatabase,
  getDatabaseVersion,
  DB_VERSION,
} from "./database"
import { executeMigrations } from "./migrations"

/**
 * Initialize database with tables but skip AsyncStorage migration
 * This function is used when we don't need to migrate old data
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeWithoutMigration(): Promise<void> {
  try {
    // Get database connection
    const db = getDatabase()

    // Check if this is the first run
    const { isFirstRun } = await initializeDatabase(db)

    // Check if we already have the current version in the database
    const currentVersion = await getDatabaseVersion(db)

    // Only execute migrations if it's the first run or we need to upgrade
    if (isFirstRun || currentVersion < DB_VERSION) {
      await executeMigrations(db, false) // Skip AsyncStorage migration
      console.log("Database initialized successfully (migration skipped)")
    } else {
      console.log("Database already initialized with current version")
    }
  } catch (error) {
    console.error("Database initialization failed:", error)
    throw new Error(`Failed to initialize database: ${error}`)
  }
}
