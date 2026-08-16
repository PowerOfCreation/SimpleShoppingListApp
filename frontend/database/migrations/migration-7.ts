import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"
import { EventTypes } from "@/types/DomainEvent"

const logger = createLogger("Migration-7")

// list_sync_settings replaces ingredient_lists.sync_enabled: whether *this
// device* syncs a list is a local decision, not something derivable from
// the (server-mergeable, rebuild-on-pull) event log - see
// sync-design-decisions.md ("Genau ein Writer für seq") and
// list-sync-settings-repository.ts for the fuller rationale. Deliberately
// its own table, not a column on ingredient_lists: that table is a
// projection whose rebuild does `DELETE FROM ingredient_lists` first, which
// silently reset sync_enabled to its default on every rebuild - the exact
// bug this migration repairs.
const CREATE_LIST_SYNC_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS list_sync_settings (
  list_id    TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
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

/**
 * Seeds list_sync_settings from each list's own todo_list.sync_enabled /
 * todo_list.sync_disabled event history (latest by rowid - local insertion
 * order, the right authority for a device-local decision, deliberately not
 * seq) rather than from ingredient_lists.sync_enabled. That column is
 * exactly what the ack-ordering race could reset to 0 via a rebuild while
 * the event proving sync was actually turned on stayed in the log - reading
 * from the log instead of the corrupted projection is what repairs those
 * lists here, with no manual intervention. Skips aggregate_ids without a
 * current ingredient_lists row (already-deleted lists) so this doesn't
 * seed orphan settings that would keep dead list ids in getEnabledIds().
 */
async function seedFromEventLog(
  db: SQLite.SQLiteDatabase,
  projectionColumnStillPresent: boolean
): Promise<void> {
  const rows = await db.getAllAsync<{ aggregate_id: string; enabled: number }>(
    `SELECT aggregate_id, CASE event_type WHEN ? THEN 1 ELSE 0 END AS enabled
     FROM domain_events
     WHERE event_type IN (?, ?)
       AND aggregate_id IN (SELECT id FROM ingredient_lists)
       AND rowid = (
         SELECT MAX(rowid) FROM domain_events AS d2
         WHERE d2.aggregate_id = domain_events.aggregate_id
           AND d2.event_type IN (?, ?)
       )`,
    EventTypes.TODO_LIST_SYNC_ENABLED,
    EventTypes.TODO_LIST_SYNC_ENABLED,
    EventTypes.TODO_LIST_SYNC_DISABLED,
    EventTypes.TODO_LIST_SYNC_ENABLED,
    EventTypes.TODO_LIST_SYNC_DISABLED
  )

  const now = Date.now()
  for (const row of rows) {
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      row.aggregate_id,
      row.enabled,
      now
    )
  }

  // Lists with no sync_enabled/disabled event at all (never touched the
  // toggle) fall back to the current projection value - for them the
  // projection was never at risk of the rebuild bug in the first place.
  // Guarded: on a second run (already-idempotent CREATE/DROP below), the
  // column this reads from is already gone.
  if (projectionColumnStillPresent) {
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at)
       SELECT id, sync_enabled, ?
       FROM ingredient_lists
       WHERE id NOT IN (SELECT list_id FROM list_sync_settings)`,
      now
    )
  }
}

export async function migrateToVersion7(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(CREATE_LIST_SYNC_SETTINGS_TABLE)

      const columnStillPresent = await columnExists(
        db,
        "ingredient_lists",
        "sync_enabled"
      )
      await seedFromEventLog(db, columnStillPresent)

      // No index referenced this column - safe to drop outright rather
      // than leave a dead, misleading column behind.
      if (columnStillPresent) {
        await db.runAsync(
          `ALTER TABLE ingredient_lists DROP COLUMN sync_enabled;`
        )
      }
    })

    logger.info("Successfully migrated database to version 7")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 7",
      7,
      error
    )
    logger.error("Error migrating to version 7", migrationError)
    return Result.fail(migrationError)
  }
}
