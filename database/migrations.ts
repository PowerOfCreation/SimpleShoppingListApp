import * as SQLite from "expo-sqlite"
import { DB_VERSION, updateDatabaseVersion } from "@/database/database"
import { getItem } from "../api/common/async-storage"
import { Ingredient } from "../types/Ingredient"

/**
 * SQL statements for creating the database schema
 */
const CREATE_INGREDIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const CREATE_DATABASE_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS database_version (
  version INTEGER PRIMARY KEY,
  migration_date INTEGER NOT NULL
);
`

/**
 * Execute database migrations
 * @param db SQLite database connection
 * @param isFirstRun Whether this is the first run of the app with SQLite
 */
export async function executeMigrations(
  db: SQLite.SQLiteDatabase,
  isFirstRun: boolean
): Promise<void> {
  // Create tables
  await createTables(db)

  // If this is the first run, migrate data from AsyncStorage
  if (isFirstRun) {
    await migrateFromAsyncStorage(db)
  }

  // Update database version
  await updateDatabaseVersion(DB_VERSION, db)
}

/**
 * Create database tables
 */
async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    // Create tables in transaction to ensure atomicity
    await db.withTransactionAsync(async () => {
      // Create ingredients table
      await db.runAsync(CREATE_INGREDIENTS_TABLE)

      // Create database version table
      await db.runAsync(CREATE_DATABASE_VERSION_TABLE)
    })
  } catch (error) {
    console.error("Error creating database tables:", error)
    throw error
  }
}

/**
 * Migrate data from AsyncStorage to SQLite
 */
async function migrateFromAsyncStorage(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  try {
    // Load ingredients from AsyncStorage
    const ingredients: Ingredient[] = (await getItem("ingredients")) || []

    if (ingredients.length === 0) {
      console.log("No ingredients found in AsyncStorage to migrate")
      return
    }

    // Insert ingredients into SQLite in a transaction
    await db.withTransactionAsync(async () => {
      const now = Date.now()

      for (const ingredient of ingredients) {
        await db.runAsync(
          `INSERT INTO ingredients (id, name, completed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          ingredient.id,
          ingredient.name,
          ingredient.completed ? 1 : 0,
          ingredient.created_at || now,
          ingredient.updated_at || now
        )
      }
    })

    console.log(
      `Successfully migrated ${ingredients.length} ingredients from AsyncStorage`
    )
  } catch (error) {
    console.error("Error migrating data from AsyncStorage:", error)
    throw error
  }
}
