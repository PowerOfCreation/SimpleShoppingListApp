import * as SQLite from "expo-sqlite"
import { DB_VERSION, updateDatabaseVersion } from "@/database/database"
import { getItem } from "../api/common/async-storage"
import { Ingredient } from "../types/Ingredient"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migrations")

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
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function executeMigrations(
  db: SQLite.SQLiteDatabase,
  isFirstRun: boolean
): Promise<Result<void, DbMigrationError>> {
  try {
    // Create tables
    const createResult = await createTables(db)
    if (!createResult.success) {
      return createResult
    }

    // If this is the first run, migrate data from AsyncStorage
    if (isFirstRun) {
      const migrateResult = await migrateFromAsyncStorage(db)
      if (!migrateResult.success) {
        return migrateResult
      }
    }

    // Update database version
    const versionResult = await updateDatabaseVersion(DB_VERSION, db)
    if (!versionResult.success) {
      return Result.fail(
        new DbMigrationError(
          "Failed to update database version",
          DB_VERSION,
          versionResult.getError()
        )
      )
    }

    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to execute migrations",
      DB_VERSION,
      error
    )
    logger.error("Error executing migrations", migrationError)
    return Result.fail(migrationError)
  }
}

/**
 * Create database tables
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function createTables(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    // Create tables in transaction to ensure atomicity
    await db.withTransactionAsync(async () => {
      // Create ingredients table
      await db.runAsync(CREATE_INGREDIENTS_TABLE)

      // Create database version table
      await db.runAsync(CREATE_DATABASE_VERSION_TABLE)
    })

    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to create database tables",
      DB_VERSION,
      error
    )
    logger.error("Error creating database tables", migrationError)
    return Result.fail(migrationError)
  }
}

/**
 * Migrate data from AsyncStorage to SQLite
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function migrateFromAsyncStorage(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    // Load ingredients from AsyncStorage
    const ingredients: Ingredient[] = (await getItem("ingredients")) || []

    if (ingredients.length === 0) {
      logger.info("No ingredients found in AsyncStorage to migrate")
      return Result.ok(undefined)
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

    logger.info(
      `Successfully migrated ${ingredients.length} ingredients from AsyncStorage`
    )

    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate data from AsyncStorage",
      DB_VERSION,
      error
    )
    logger.error("Error migrating data from AsyncStorage", migrationError)
    return Result.fail(migrationError)
  }
}
