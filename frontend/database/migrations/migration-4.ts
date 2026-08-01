import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"

const logger = createLogger("Migration-4")

// `sync_enabled` lives on the read-model table, not on domain_events: the
// event log is append-only and projections rebuild the read model from it,
// so sync state (infrastructure concern) must not be baked into log rows
// (domain concern). ALTER TABLE ADD COLUMN is not idempotent in SQLite (it
// throws "duplicate column name" on a second run), so this is guarded
// explicitly below rather than asserting idempotency the migration doesn't
// actually have - unlike migration-3, which shares that same latent gap.
const ADD_SYNC_ENABLED_COLUMN = `
ALTER TABLE ingredient_lists ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0;
`

// Deliberately no FOREIGN KEY to domain_events(event_id): expo-sqlite does
// not enable PRAGMA foreign_keys (SQLite's own default is off), while
// expo-sqlite-mock (backed by better-sqlite3) enables it by default. A FK
// here would be enforced in tests and silently inert on-device - exactly
// the kind of constraint that makes a test pass without protecting
// anything real. domain_events is append-only and never deleted, so the
// cascade would have been decorative anyway.
const CREATE_EVENT_OUTBOX_TABLE = `
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id        TEXT PRIMARY KEY,
  aggregate_id    TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  created_at      INTEGER NOT NULL
);
`

const CREATE_EVENT_OUTBOX_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_event_outbox_status
ON event_outbox(status, created_at);
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

export async function migrateToVersion4(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (!(await columnExists(db, "ingredient_lists", "sync_enabled"))) {
        await db.runAsync(ADD_SYNC_ENABLED_COLUMN)
      }
      await db.runAsync(CREATE_EVENT_OUTBOX_TABLE)
      await db.runAsync(CREATE_EVENT_OUTBOX_STATUS_INDEX)
    })

    logger.info("Successfully migrated database to version 4")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 4",
      4,
      error
    )
    logger.error("Error migrating to version 4", migrationError)
    return Result.fail(migrationError)
  }
}
