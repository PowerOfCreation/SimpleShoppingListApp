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
    await db.execAsync(`
      DROP TABLE IF EXISTS list_sync_settings;
      CREATE TABLE list_sync_settings (
        list_id    TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  it("adds the permission_denied column, defaulting existing rows to 0", async () => {
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)`,
      "list-1",
      1,
      1000
    )

    const result = await migrateToVersion8(db)

    expect(result.success).toBe(true)
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(list_sync_settings);`
    )
    expect(columns.some((c) => c.name === "permission_denied")).toBe(true)
    const row = await db.getFirstAsync<{ permission_denied: number }>(
      `SELECT permission_denied FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(row?.permission_denied).toBe(0)
  })

  it("is idempotent (safe to run twice)", async () => {
    const first = await migrateToVersion8(db)
    const second = await migrateToVersion8(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
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
