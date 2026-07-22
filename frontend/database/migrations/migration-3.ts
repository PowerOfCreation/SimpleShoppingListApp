import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-3")

const ADD_PRIORITY_COLUMN = `
ALTER TABLE ingredients ADD COLUMN priority INTEGER;
`

export async function migrateToVersion3(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(ADD_PRIORITY_COLUMN)
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
