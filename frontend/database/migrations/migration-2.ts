import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-2")

const CREATE_APP_PREFERENCES_TABLE = `
CREATE TABLE IF NOT EXISTS app_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export async function migrateToVersion2(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(CREATE_APP_PREFERENCES_TABLE)
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
