import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-9")

// Device-local diagnostic: why the server permanently rejected a list's
// events (400), shown to the user so they can report it. Not idempotent in
// SQLite - guarded via columnExists, same pattern as migration-4/5/6/8.
const ADD_REJECTION_REASON_COLUMN = `
ALTER TABLE list_sync_state ADD COLUMN rejection_reason TEXT;
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

export async function migrateToVersion9(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (!(await columnExists(db, "list_sync_state", "rejection_reason"))) {
        await db.runAsync(ADD_REJECTION_REASON_COLUMN)
      }
    })

    logger.info("Successfully migrated database to version 9")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 9",
      9,
      error
    )
    logger.error("Error migrating to version 9", migrationError)
    return Result.fail(migrationError)
  }
}
