import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-8")

// ALTER TABLE ADD COLUMN is not idempotent in SQLite - guarded via
// columnExists below, same pattern as migration-4/5/6. Lives on
// list_sync_settings, not app_preferences: that table is already deleted
// per-list on list delete/logout (see ListSyncSettingsRepository.removeWithin),
// so this flag is cleaned up automatically instead of leaking a
// sync_permission_denied:<listId> row forever.
const ADD_PERMISSION_DENIED_COLUMN = `
ALTER TABLE list_sync_settings ADD COLUMN permission_denied INTEGER NOT NULL DEFAULT 0;
`

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
      if (
        !(await columnExists(db, "list_sync_settings", "permission_denied"))
      ) {
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
