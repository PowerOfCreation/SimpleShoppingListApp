import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-1")

const CREATE_INGREDIENT_LISTS_TABLE = `
CREATE TABLE IF NOT EXISTS ingredient_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const CREATE_INGREDIENTS_TABLE = `
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  list_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (list_id) REFERENCES ingredient_lists(id) ON DELETE CASCADE
);
`

const CREATE_DATABASE_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS database_version (
  version INTEGER PRIMARY KEY,
  migration_date INTEGER NOT NULL
);
`

const CREATE_DOMAIN_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS domain_events (
  event_id       TEXT PRIMARY KEY,
  event_type     TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  occurred_at    INTEGER NOT NULL,
  client_id      TEXT NOT NULL,
  payload        TEXT NOT NULL
);
`

const CREATE_DOMAIN_EVENTS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
ON domain_events(aggregate_id, occurred_at);
`

export async function migrateToVersion1(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(CREATE_INGREDIENT_LISTS_TABLE)
      await db.runAsync(CREATE_INGREDIENTS_TABLE)
      await db.runAsync(CREATE_DATABASE_VERSION_TABLE)
      await db.runAsync(CREATE_DOMAIN_EVENTS_TABLE)
      await db.runAsync(CREATE_DOMAIN_EVENTS_INDEX)
    })

    logger.info("Successfully migrated database to version 1")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 1",
      1,
      error
    )
    logger.error("Error migrating to version 1", migrationError)
    return Result.fail(migrationError)
  }
}
