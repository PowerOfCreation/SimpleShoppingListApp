import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-8")

// "settings" stops fitting once this table also carries a server-derived
// status flag, not just a user-set toggle - rename before adding the
// column. Neither ALTER is idempotent in SQLite - guarded via
// tableExists/columnExists, same pattern as migration-4/5/6. Still deleted
// per-list on list delete/logout (see ListSyncStateRepository.removeWithin),
// so permission_denied is cleaned up automatically instead of leaking a
// sync_permission_denied:<listId> row forever the way app_preferences would.
const RENAME_TABLE = `
ALTER TABLE list_sync_settings RENAME TO list_sync_state;
`

const ADD_PERMISSION_DENIED_COLUMN = `
ALTER TABLE list_sync_state ADD COLUMN permission_denied INTEGER NOT NULL DEFAULT 0;
`

async function tableExists(
  db: SQLite.SQLiteDatabase,
  table: string
): Promise<boolean> {
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?;`,
    table
  )
  return (row?.cnt ?? 0) > 0
}

async function columnExists(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`
  )
  return columns.some((c) => c.name === column)
}

export async function migrateToVersion8(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (await tableExists(db, "list_sync_settings")) {
        if (await tableExists(db, "list_sync_state")) {
          // A legacy version-number reset (see data-migration.ts) can rerun
          // migration-7 on a device already past this migration - its
          // CREATE TABLE IF NOT EXISTS then recreates list_sync_settings
          // from scratch, colliding with the already-renamed table. That
          // recreate seeds only from domain_events (see migration-7's
          // seedFromEventLog), the same source list_sync_state was already
          // built from, so the stray copy has nothing list_sync_state
          // doesn't - drop it instead of renaming into a collision.
          await db.runAsync(`DROP TABLE list_sync_settings;`)
        } else {
          await db.runAsync(RENAME_TABLE)
        }
      }
      if (!(await columnExists(db, "list_sync_state", "permission_denied"))) {
        await db.runAsync(ADD_PERMISSION_DENIED_COLUMN)
      }
    })

    logger.info("Successfully migrated database to version 8")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 8",
      8,
      error
    )
    logger.error("Error migrating to version 8", migrationError)
    return Result.fail(migrationError)
  }
}
