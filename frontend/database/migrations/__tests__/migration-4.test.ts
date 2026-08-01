import * as SQLite from "expo-sqlite"
import { migrateToVersion4 } from "../migration-4"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion4", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS event_outbox;
      DROP TABLE IF EXISTS ingredient_lists;
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  it("adds sync_enabled to ingredient_lists, defaulting to 0", async () => {
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      "list-1",
      "Rewe",
      1000,
      1000
    )

    const result = await migrateToVersion4(db)
    expect(result.success).toBe(true)

    const row = await db.getFirstAsync<{ sync_enabled: number }>(
      `SELECT sync_enabled FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(row?.sync_enabled).toBe(0)
  })

  it("creates the event_outbox table", async () => {
    await migrateToVersion4(db)

    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='event_outbox';`
    )
    expect(tables.length).toBe(1)
  })

  it("creates the event_outbox status index", async () => {
    await migrateToVersion4(db)

    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_event_outbox_status';`
    )
    expect(indexes.length).toBe(1)
  })

  it("is idempotent (safe to run twice), unlike a bare ALTER TABLE", async () => {
    const first = await migrateToVersion4(db)
    const second = await migrateToVersion4(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
  })

  it("does not clobber sync_enabled already set when run again", async () => {
    await migrateToVersion4(db)
    await db.runAsync(
      `INSERT INTO ingredient_lists (id, name, created_at, updated_at, sync_enabled) VALUES (?, ?, ?, ?, ?)`,
      "list-1",
      "Rewe",
      1000,
      1000,
      1
    )

    await migrateToVersion4(db)

    const row = await db.getFirstAsync<{ sync_enabled: number }>(
      `SELECT sync_enabled FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(row?.sync_enabled).toBe(1)
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion4(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
