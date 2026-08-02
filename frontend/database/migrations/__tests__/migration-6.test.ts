import * as SQLite from "expo-sqlite"
import { migrateToVersion6 } from "../migration-6"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion6", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS sync_cursors;
      DROP TABLE IF EXISTS domain_events;
      CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        list_id TEXT,
        occurred_at INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE sync_cursors (
        list_id        TEXT PRIMARY KEY,
        last_seen_seq  INTEGER NOT NULL DEFAULT 0,
        last_pulled_at INTEGER
      );
    `)
  })

  it("adds the seq column to domain_events", async () => {
    const result = await migrateToVersion6(db)

    expect(result.success).toBe(true)
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(domain_events);`
    )
    expect(columns.some((c) => c.name === "seq")).toBe(true)
  })

  it("creates the domain_events list/seq index", async () => {
    await migrateToVersion6(db)

    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_domain_events_list_seq';`
    )
    expect(indexes.length).toBe(1)
  })

  it("resets every list's pull cursor so the next pull backfills seq", async () => {
    await db.runAsync(
      `INSERT INTO sync_cursors (list_id, last_seen_seq, last_pulled_at) VALUES (?, ?, ?)`,
      "list-1",
      42,
      1000
    )

    await migrateToVersion6(db)

    const row = await db.getFirstAsync<{ last_seen_seq: number }>(
      `SELECT last_seen_seq FROM sync_cursors WHERE list_id = 'list-1'`
    )
    expect(row?.last_seen_seq).toBe(0)
  })

  it("is idempotent (safe to run twice)", async () => {
    const first = await migrateToVersion6(db)
    const second = await migrateToVersion6(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion6(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
