import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-3")

const ADD_PRIORITY_COLUMN = `
ALTER TABLE ingredients ADD COLUMN priority INTEGER;
`

// ALTER TABLE ADD COLUMN is not idempotent in SQLite (throws "duplicate
// column name" on a second run) - guarded explicitly below, same pattern as
// migration-4's sync_enabled column.
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

export async function migrateToVersion3(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (!(await columnExists(db, "ingredients", "priority"))) {
        await db.runAsync(ADD_PRIORITY_COLUMN)
      }
    })

    logger.info("Successfully migrated database to version 3")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 3",
      3,
      error
    )
    logger.error("Error migrating to version 3", migrationError)
    return Result.fail(migrationError)
  }
}
