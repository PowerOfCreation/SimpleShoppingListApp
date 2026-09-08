import * as SQLite from "expo-sqlite"
import { DB_VERSION, updateDatabaseVersion } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"
import { migrateToVersion1 } from "@/database/migrations/migration-1"
import { migrateToVersion2 } from "@/database/migrations/migration-2"
import { migrateToVersion3 } from "@/database/migrations/migration-3"
import { migrateToVersion4 } from "@/database/migrations/migration-4"
import { migrateToVersion5 } from "@/database/migrations/migration-5"
import { migrateToVersion6 } from "@/database/migrations/migration-6"
import { migrateToVersion7 } from "@/database/migrations/migration-7"
import { migrateToVersion8 } from "@/database/migrations/migration-8"

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
  { version: 3, migrate: migrateToVersion3 },
  { version: 4, migrate: migrateToVersion4 },
  { version: 5, migrate: migrateToVersion5 },
  { version: 6, migrate: migrateToVersion6 },
  { version: 7, migrate: migrateToVersion7 },
  { version: 8, migrate: migrateToVersion8 },
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

      // Record the version that actually just ran, not the module's
      // DB_VERSION target - a build tested mid-development (DB_VERSION
      // already bumped, a later migration not yet wired up) must not stamp
      // a version higher than what really executed, or that gap is skipped
      // forever on every later, correct build.
      const versionResult = await updateDatabaseVersion(migration.version, db)
      if (!versionResult.success) {
        return Result.fail(
          new DbMigrationError(
            "Failed to update database version",
            migration.version,
            versionResult.getError()
          )
        )
      }
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
