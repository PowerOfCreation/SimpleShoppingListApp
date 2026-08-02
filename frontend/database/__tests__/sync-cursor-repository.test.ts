import * as SQLite from "expo-sqlite"
import { SyncCursorRepository } from "../sync-cursor-repository"
import { getDatabase } from "../database"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

describe("SyncCursorRepository", () => {
  let db: SQLite.SQLiteDatabase
  let repo: SyncCursorRepository

  beforeEach(async () => {
    db = getDatabase()
    repo = new SyncCursorRepository(db)

    await db.execAsync(`
      DROP TABLE IF EXISTS sync_cursors;
      CREATE TABLE sync_cursors (
        list_id TEXT PRIMARY KEY,
        last_seen_seq INTEGER NOT NULL DEFAULT 0,
        last_pulled_at INTEGER
      )
    `)
  })

  describe("get", () => {
    it("returns null for a list with no cursor yet", async () => {
      const result = await repo.get("list-1")

      expect(result.success).toBe(true)
      expect(result.getValue()).toBeNull()
    })

    it("returns the stored cursor", async () => {
      await repo.set("list-1", 42, 1000)

      const result = await repo.get("list-1")

      expect(result.getValue()).toEqual({
        list_id: "list-1",
        last_seen_seq: 42,
        last_pulled_at: 1000,
      })
    })
  })

  describe("getAll", () => {
    it("returns every stored cursor", async () => {
      await repo.set("list-1", 1, 1000)
      await repo.set("list-2", 2, 2000)

      const result = await repo.getAll()

      expect(
        result
          .getValue()!
          .map((r) => r.list_id)
          .sort()
      ).toEqual(["list-1", "list-2"])
    })
  })

  describe("set", () => {
    it("inserts a new cursor", async () => {
      const result = await repo.set("list-1", 5, 1000)

      expect(result.success).toBe(true)
      const row = await repo.get("list-1")
      expect(row.getValue()?.last_seen_seq).toBe(5)
    })

    it("overwrites an existing cursor rather than erroring", async () => {
      await repo.set("list-1", 5, 1000)

      await repo.set("list-1", 9, 2000)

      const row = await repo.get("list-1")
      expect(row.getValue()).toEqual({
        list_id: "list-1",
        last_seen_seq: 9,
        last_pulled_at: 2000,
      })
    })
  })

  describe("setWithin", () => {
    it("upserts using the given db handle without opening its own transaction", async () => {
      await repo.setWithin(db, "list-1", 3, 1000)

      const row = await repo.get("list-1")
      expect(row.getValue()?.last_seen_seq).toBe(3)
    })

    it("can be called from inside an existing transaction", async () => {
      await db.withTransactionAsync(async () => {
        await repo.setWithin(db, "list-1", 7, 1000)
      })

      const row = await repo.get("list-1")
      expect(row.getValue()?.last_seen_seq).toBe(7)
    })
  })

  describe("clear", () => {
    it("removes the cursor for a list", async () => {
      await repo.set("list-1", 5, 1000)

      await repo.clear("list-1")

      const row = await repo.get("list-1")
      expect(row.getValue()).toBeNull()
    })

    it("is a no-op for a list with no cursor", async () => {
      const result = await repo.clear("no-such-list")
      expect(result.success).toBe(true)
    })
  })
})
