import * as SQLite from "expo-sqlite"
import { migrateToVersion8 } from "../migration-8"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion8", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    // Simulates the table exactly as migration-7 leaves it, under its old
    // name - migration-8 is what renames it.
    await db.execAsync(`
      DROP TABLE IF EXISTS list_sync_settings;
      DROP TABLE IF EXISTS list_sync_state;
      CREATE TABLE list_sync_settings (
        list_id    TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  it("renames list_sync_settings to list_sync_state and adds permission_denied, defaulting existing rows to 0", async () => {
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)`,
      "list-1",
      1,
      1000
    )

    const result = await migrateToVersion8(db)

    expect(result.success).toBe(true)
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('list_sync_settings', 'list_sync_state');`
    )
    expect(tables.map((t) => t.name)).toEqual(["list_sync_state"])
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(list_sync_state);`
    )
    expect(columns.some((c) => c.name === "permission_denied")).toBe(true)
    const row = await db.getFirstAsync<{ permission_denied: number }>(
      `SELECT permission_denied FROM list_sync_state WHERE list_id = 'list-1'`
    )
    expect(row?.permission_denied).toBe(0)
  })

  it("is idempotent (safe to run twice)", async () => {
    const first = await migrateToVersion8(db)
    const second = await migrateToVersion8(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
  })

  it("drops a stray list_sync_settings recreated by a rerun of migration-7 on an already-renamed database", async () => {
    // Simulates a legacy version-number reset (see data-migration.ts):
    // this device already migrated to list_sync_state, but migration-7's
    // CREATE TABLE IF NOT EXISTS reran and recreated list_sync_settings
    // from scratch alongside it.
    await migrateToVersion8(db)
    await db.runAsync(
      `INSERT INTO list_sync_state (list_id, enabled, updated_at, permission_denied) VALUES (?, ?, ?, ?)`,
      "list-1",
      1,
      1000,
      1
    )
    await db.execAsync(`
      CREATE TABLE list_sync_settings (
        list_id    TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)

    const result = await migrateToVersion8(db)

    expect(result.success).toBe(true)
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('list_sync_settings', 'list_sync_state');`
    )
    expect(tables.map((t) => t.name)).toEqual(["list_sync_state"])
    // The real, already-migrated row survives untouched.
    const row = await db.getFirstAsync<{ permission_denied: number }>(
      `SELECT permission_denied FROM list_sync_state WHERE list_id = 'list-1'`
    )
    expect(row?.permission_denied).toBe(1)
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion8(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
