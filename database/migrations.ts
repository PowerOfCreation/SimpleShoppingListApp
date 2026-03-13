import * as SQLite from "expo-sqlite"
import { DB_VERSION, updateDatabaseVersion } from "@/database/database"
import { getItem } from "../api/common/async-storage"
import { Ingredient } from "../types/Ingredient"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"
import { NIL_UUID } from "@/constants/Uuids"

const logger = createLogger("Migrations")

/**
 * SQL statements for creating the database schema (version 2)
 */
const CREATE_INGREDIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  list_id TEXT,
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

const CREATE_INGREDIENT_LISTS_TABLE = `
CREATE TABLE IF NOT EXISTS ingredient_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

/**
 * Execute database migrations
 * @param db SQLite database connection
 * @param isFirstRun Whether this is the first run of the app with SQLite
 * @param currentVersion Current database version
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function executeMigrations(
  db: SQLite.SQLiteDatabase,
  isFirstRun: boolean,
  currentVersion: number = 0
): Promise<Result<void, DbMigrationError>> {
  try {
    // Create tables if first run
    if (isFirstRun || currentVersion === 0) {
      const createResult = await createTables(db)
      if (!createResult.success) {
        return createResult
      }

      // Create default list on first run
      const defaultListResult = await createDefaultList(db)
      if (!defaultListResult.success) {
        return Result.fail(defaultListResult.getError()!)
      }
      const defaultListId = defaultListResult.getValue()!

      // If this is the first run, migrate data from AsyncStorage
      if (isFirstRun) {
        const migrateResult = await migrateFromAsyncStorage(db, defaultListId)
        if (!migrateResult.success) {
          return migrateResult
        }
      }
    } else {
      // Run version-specific migrations for existing databases
      if (currentVersion < 2) {
        const v2Result = await migrateToVersion2(db)
        if (!v2Result.success) {
          return v2Result
        }
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

      // Create ingredient lists table
      await db.runAsync(CREATE_INGREDIENT_LISTS_TABLE)
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
 * Create default ingredient list
 * @param db SQLite database connection
 * @returns Result containing the default list ID on success or DbMigrationError on failure
 */
export async function createDefaultList(
  db: SQLite.SQLiteDatabase
): Promise<Result<string, DbMigrationError>> {
  try {
    const now = Date.now()
    const defaultListId = NIL_UUID

    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      defaultListId,
      "Standard List",
      now,
      now
    )

    logger.info("Created default ingredient list")
    return Result.ok(defaultListId)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to create default ingredient list",
      DB_VERSION,
      error
    )
    logger.error("Error creating default list", migrationError)
    return Result.fail(migrationError)
  }
}

/**
 * Migrate data from AsyncStorage to SQLite
 * @param db SQLite database connection
 * @param defaultListId The ID of the default list to assign ingredients to
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function migrateFromAsyncStorage(
  db: SQLite.SQLiteDatabase,
  defaultListId: string
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
          `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ingredient.id,
          ingredient.name,
          ingredient.completed ? 1 : 0,
          defaultListId,
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

/**
 * Migrate database from version 1 to version 2
 * Adds ingredient lists functionality:
 * - Creates ingredient_lists table
 * - Adds list_id column to ingredients table
 * - Creates a default "Standard List"
 * - Assigns all existing ingredients to the default list
 * @returns Result containing void on success or DbMigrationError on failure
 */
export async function migrateToVersion2(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      const now = Date.now()

      // Create ingredient_lists table
      await db.runAsync(CREATE_INGREDIENT_LISTS_TABLE)

      // Use nil UUID as default list ID
      const defaultListId = NIL_UUID

      // Create default "Standard List"
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        defaultListId,
        "Standard List",
        now,
        now
      )

      // Add list_id column to ingredients table
      await db.runAsync(`
        ALTER TABLE ingredients ADD COLUMN list_id TEXT;
      `)

      // Assign all existing ingredients to the default list
      await db.runAsync(
        `
        UPDATE ingredients SET list_id = ?;
      `,
        defaultListId
      )

      // Update database version
      await db.runAsync(
        `INSERT OR REPLACE INTO database_version (version, migration_date)
         VALUES (2, ?)`,
        now
      )
    })

    logger.info("Successfully migrated database to version 2")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 2",
      2,
      error
    )
    logger.error("Error migrating to version 2", migrationError)
    return Result.fail(migrationError)
  }
}
