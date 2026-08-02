import * as SQLite from "expo-sqlite"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { DbMigrationError } from "@/api/common/error-types"
import { EventTypes } from "@/types/DomainEvent"

const logger = createLogger("Migration-5")

// ALTER TABLE ADD COLUMN is not idempotent in SQLite (throws "duplicate
// column name" on a second run) - guarded explicitly below, same pattern as
// migration-4's sync_enabled column.
const ADD_LIST_ID_COLUMN = `
ALTER TABLE domain_events ADD COLUMN list_id TEXT;
`

const CREATE_DOMAIN_EVENTS_LIST_INDEX = `
CREATE INDEX IF NOT EXISTS idx_domain_events_list
ON domain_events(list_id, occurred_at);
`

// Deliberately no FOREIGN KEY - domain_events is append-only and list_id can
// legitimately be NULL for events whose list could not be resolved during
// backfill (see below), which a FK would reject outright.
const CREATE_SYNC_CURSORS_TABLE = `
CREATE TABLE IF NOT EXISTS sync_cursors (
  list_id        TEXT PRIMARY KEY,
  last_seen_seq  INTEGER NOT NULL DEFAULT 0,
  last_pulled_at INTEGER
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
 * Step 1: for todo_list.* events, list_id is just the aggregate_id - the
 * list *is* the aggregate.
 */
async function backfillTodoListEvents(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  await db.runAsync(
    `UPDATE domain_events SET list_id = aggregate_id
     WHERE aggregate_type = 'todo_list' AND list_id IS NULL`
  )
}

/**
 * Step 2: ingredient.created carries the parent list id in its payload
 * ({name, listId}). Parsed in TypeScript rather than via SQLite's json_extract
 * so this migration doesn't depend on the JSON1 extension being compiled
 * into both expo-sqlite (on-device) and expo-sqlite-mock/better-sqlite3
 * (tests).
 */
async function backfillIngredientCreatedEvents(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  const rows = await db.getAllAsync<{ event_id: string; payload: string }>(
    `SELECT event_id, payload FROM domain_events
     WHERE event_type = ? AND list_id IS NULL`,
    EventTypes.INGREDIENT_CREATED
  )

  for (const row of rows) {
    let listId: unknown
    try {
      listId = JSON.parse(row.payload)?.listId
    } catch (error) {
      logger.warn(
        `Skipping unparseable ingredient.created payload for event ${row.event_id}`,
        error
      )
      continue
    }
    if (typeof listId !== "string" || !listId) {
      continue
    }
    await db.runAsync(
      `UPDATE domain_events SET list_id = ? WHERE event_id = ?`,
      listId,
      row.event_id
    )
  }
}

/**
 * Step 3: every other ingredient.* event (updated/deleted/priority_*) only
 * carries the ingredient id as aggregate_id, not the list. Resolve it by
 * joining back to that ingredient's own ingredient.created event, which step
 * 2 just backfilled.
 */
async function backfillIngredientEventsFromCreated(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  await db.runAsync(
    `UPDATE domain_events SET list_id = (
       SELECT c.list_id FROM domain_events c
       WHERE c.aggregate_id = domain_events.aggregate_id
         AND c.event_type = ?
         AND c.list_id IS NOT NULL
       LIMIT 1
     )
     WHERE aggregate_type = 'ingredient' AND list_id IS NULL`,
    EventTypes.INGREDIENT_CREATED
  )
}

/**
 * Step 4: last-chance fallback for ingredients whose own created event is
 * missing from the log (e.g. lost to an earlier bug) but which still exist
 * in the current projection - resolve list_id from the read model instead.
 * Anything still NULL after this is simply never synced.
 */
async function backfillIngredientEventsFromProjection(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  await db.runAsync(
    `UPDATE domain_events SET list_id = (
       SELECT i.list_id FROM ingredients i
       WHERE i.id = domain_events.aggregate_id
     )
     WHERE aggregate_type = 'ingredient' AND list_id IS NULL`
  )
}

export async function migrateToVersion5(
  db: SQLite.SQLiteDatabase
): Promise<Result<void, DbMigrationError>> {
  try {
    await db.withTransactionAsync(async () => {
      if (!(await columnExists(db, "domain_events", "list_id"))) {
        await db.runAsync(ADD_LIST_ID_COLUMN)
      }

      await backfillTodoListEvents(db)
      await backfillIngredientCreatedEvents(db)
      await backfillIngredientEventsFromCreated(db)
      await backfillIngredientEventsFromProjection(db)

      await db.runAsync(CREATE_DOMAIN_EVENTS_LIST_INDEX)
      await db.runAsync(CREATE_SYNC_CURSORS_TABLE)
    })

    logger.info("Successfully migrated database to version 5")
    return Result.ok(undefined)
  } catch (error) {
    const migrationError = new DbMigrationError(
      "Failed to migrate to version 5",
      5,
      error
    )
    logger.error("Error migrating to version 5", migrationError)
    return Result.fail(migrationError)
  }
}
