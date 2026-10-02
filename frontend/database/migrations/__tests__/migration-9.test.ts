import * as SQLite from "expo-sqlite"
import { migrateToVersion9 } from "../migration-9"
import { getDatabase } from "@/database/database"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion9", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS list_sync_state;
      CREATE TABLE list_sync_state (
        list_id           TEXT PRIMARY KEY,
        enabled           INTEGER NOT NULL DEFAULT 0,
        updated_at        INTEGER NOT NULL,
        permission_denied INTEGER NOT NULL DEFAULT 0
      );
    `)
  })

  it("adds a nullable rejection_reason, leaving existing rows null", async () => {
    await db.runAsync(
      `INSERT INTO list_sync_state (list_id, enabled, updated_at) VALUES ('list-1', 1, 1000)`
    )

    const result = await migrateToVersion9(db)

    expect(result.success).toBe(true)
    const row = await db.getFirstAsync<{ rejection_reason: string | null }>(
      `SELECT rejection_reason FROM list_sync_state WHERE list_id = 'list-1'`
    )
    expect(row?.rejection_reason).toBeNull()
  })

  it("is idempotent (safe to run twice)", async () => {
    expect((await migrateToVersion9(db)).success).toBe(true)
    expect((await migrateToVersion9(db)).success).toBe(true)
  })
})
