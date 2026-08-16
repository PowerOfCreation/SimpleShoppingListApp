import * as SQLite from "expo-sqlite"
import { ListSyncSettingsRepository } from "../list-sync-settings-repository"
import { getDatabase } from "../database"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

describe("ListSyncSettingsRepository", () => {
  let db: SQLite.SQLiteDatabase
  let repository: ListSyncSettingsRepository

  beforeEach(async () => {
    db = getDatabase()
    repository = new ListSyncSettingsRepository(db)

    await db.execAsync(`DROP TABLE IF EXISTS list_sync_settings;`)
    await db.execAsync(`
      CREATE TABLE list_sync_settings (
        list_id    TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)
  })

  describe("setEnabled / isEnabled", () => {
    it("turns sync on for a list with no prior row", async () => {
      const result = await repository.setEnabled("list-1", true)
      expect(result.success).toBe(true)

      const enabledResult = await repository.isEnabled("list-1")
      expect(enabledResult.getValue()).toBe(true)
    })

    it("turns sync back off for an already-enabled list", async () => {
      await repository.setEnabled("list-1", true)
      await repository.setEnabled("list-1", false)

      const enabledResult = await repository.isEnabled("list-1")
      expect(enabledResult.getValue()).toBe(false)
    })

    it("a list never toggled is not enabled", async () => {
      const enabledResult = await repository.isEnabled("list-1")
      expect(enabledResult.getValue()).toBe(false)
    })
  })

  describe("getEnabledIds", () => {
    it("returns only ids of sync-enabled lists", async () => {
      await repository.setEnabled("list-1", true)
      await repository.setEnabled("list-2", false)
      await repository.setEnabled("list-3", true)

      const result = await repository.getEnabledIds()

      expect(result.success).toBe(true)
      expect(result.getValue()!.sort()).toEqual(["list-1", "list-3"])
    })

    it("returns an empty array when nothing is sync-enabled", async () => {
      const result = await repository.getEnabledIds()
      expect(result.getValue()).toEqual([])
    })
  })

  describe("setEnabledWithin", () => {
    it("writes within a caller-supplied transaction without opening its own", async () => {
      await db.withTransactionAsync(async () => {
        await repository.setEnabledWithin(db, "list-1", true)
      })

      const enabledResult = await repository.isEnabled("list-1")
      expect(enabledResult.getValue()).toBe(true)
    })
  })

  describe("removeWithin", () => {
    it("deletes the row for a list within a caller-supplied transaction", async () => {
      await repository.setEnabled("list-1", true)

      await db.withTransactionAsync(async () => {
        await repository.removeWithin(db, "list-1")
      })

      const enabledResult = await repository.isEnabled("list-1")
      expect(enabledResult.getValue()).toBe(false)
    })
  })
})
