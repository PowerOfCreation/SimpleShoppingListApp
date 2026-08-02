import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-6")

// ALTER TABLE ADD COLUMN is not idempotent in SQLite - guarded via
// columnExists below, same pattern as migration-4/5.
const ADD_SEQ_COLUMN = `
ALTER TABLE domain_events ADD COLUMN seq INTEGER;
`

const CREATE_DOMAIN_EVENTS_LIST_SEQ_INDEX = `
CREATE INDEX IF NOT EXISTS idx_domain_events_list_seq
ON domain_events(list_id, seq);
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

export async function migrateToVersion6(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (!(await columnExists(db, "domain_events", "seq"))) {
        await db.runAsync(ADD_SEQ_COLUMN)
      }
      await db.runAsync(CREATE_DOMAIN_EVENTS_LIST_SEQ_INDEX)

      // Existing rows have no seq yet, even for lists already synced -
      // resetting their cursor makes the next pull re-fetch the full
      // history and backfill seq on each row (EventRepository.insertRemote
      // upserts seq for a row it already has).
      await db.runAsync(`UPDATE sync_cursors SET last_seen_seq = 0`)
    })

    logger.info("Successfully migrated database to version 6")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 6",
      6,
      error
    )
    logger.error("Error migrating to version 6", migrationError)
    return Result.fail(migrationError)
  }
}
