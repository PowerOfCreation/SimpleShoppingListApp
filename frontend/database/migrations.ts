import * as SQLite from "expo-sqlite"
import { DB_VERSION, updateDatabaseVersion } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"
import { migrateToVersion1 } from "@/database/migrations/migration-1"
import { migrateToVersion2 } from "@/database/migrations/migration-2"

const logger = createLogger("Migrations")

type Migration = {
  version: number
  migrate: (
    db: SQLite.SQLiteDatabase
  ) => Promise<Result<void, DbMigrationError>>
}

const MIGRATIONS: Migration[] = [
  { version: 1, migrate: migrateToVersion1 },
  { version: 2, migrate: migrateToVersion2 },
]

export async function executeMigrations(
  db: SQLite.SQLiteDatabase,
  currentVersion: number = 0
): Promise<Result<void, DbMigrationError>> {
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue
      const result = await migration.migrate(db)
      if (!result.success) return result
    }

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
