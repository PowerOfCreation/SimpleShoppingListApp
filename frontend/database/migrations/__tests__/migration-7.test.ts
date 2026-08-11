import * as SQLite from "expo-sqlite"
import { migrateToVersion7 } from "../migration-7"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"
import { EventTypes } from "@/types/DomainEvent"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion7", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS list_sync_settings;
      DROP TABLE IF EXISTS ingredient_lists;
      DROP TABLE IF EXISTS domain_events;
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        list_id TEXT,
        occurred_at INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        seq INTEGER
      );
    `)
  })

  async function insertList(id: string, syncEnabled: number): Promise<void> {
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at, sync_enabled) VALUES (?, ?, ?, ?, ?)`,
      id,
      "List " + id,
      1000,
      1000,
      syncEnabled
    )
  }

  async function insertEvent(
    eventId: string,
    listId: string,
    eventType: string
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload) VALUES (?, ?, ?, 'todo_list', ?, 1000, 'device-1', '{}')`,
      eventId,
      eventType,
      listId,
      listId
    )
  }

  it("creates the list_sync_settings table", async () => {
    const result = await migrateToVersion7(db)

    expect(result.success).toBe(true)
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='list_sync_settings';`
    )
    expect(tables.length).toBe(1)
  })

  it("drops ingredient_lists.sync_enabled", async () => {
    await migrateToVersion7(db)

    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(ingredient_lists);`
    )
    expect(columns.some((c) => c.name === "sync_enabled")).toBe(false)
  })

  it("repairs a list whose projection was reset to 0 by the ack-ordering race, by reading the event log instead", async () => {
    // The exact bug this migration fixes: sync_enabled = 0 in the
    // projection (a rebuild reset it), but the event proving the user
    // actually turned sync on is still sitting in the log.
    await insertList("list-1", 0)
    await insertEvent("e1", "list-1", EventTypes.TODO_LIST_CREATED)
    await insertEvent("e2", "list-1", EventTypes.TODO_LIST_SYNC_ENABLED)

    const result = await migrateToVersion7(db)
    expect(result.success).toBe(true)

    const row = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(row?.enabled).toBe(1)
  })

  it("uses the latest sync_enabled/sync_disabled event, not just the first one seen", async () => {
    await insertList("list-1", 1)
    await insertEvent("e1", "list-1", EventTypes.TODO_LIST_CREATED)
    await insertEvent("e2", "list-1", EventTypes.TODO_LIST_SYNC_ENABLED)
    await insertEvent("e3", "list-1", EventTypes.TODO_LIST_SYNC_DISABLED)

    await migrateToVersion7(db)

    const row = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(row?.enabled).toBe(0)
  })

  it("falls back to the projection's current value for a list with no sync event in its history", async () => {
    await insertList("list-1", 1)
    await insertEvent("e1", "list-1", EventTypes.TODO_LIST_CREATED)

    await migrateToVersion7(db)

    const row = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(row?.enabled).toBe(1)
  })

  it("is idempotent (safe to run twice)", async () => {
    await insertList("list-1", 0)
    await insertEvent("e1", "list-1", EventTypes.TODO_LIST_CREATED)
    await insertEvent("e2", "list-1", EventTypes.TODO_LIST_SYNC_ENABLED)

    const first = await migrateToVersion7(db)
    expect(first.success).toBe(true)
    const second = await migrateToVersion7(db)
    expect(second.success).toBe(true)

    const row = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(row?.enabled).toBe(1)
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion7(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
