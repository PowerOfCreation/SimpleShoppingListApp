import * as SQLite from "expo-sqlite"
import { executeMigrations, migrateToVersion1 } from "../migrations"
import { getDatabase, DB_VERSION } from "../database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("Migrations", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS database_version;
      DROP TABLE IF EXISTS ingredients;
      DROP TABLE IF EXISTS ingredient_lists;
      DROP TABLE IF EXISTS domain_events;
    `)
  })

  describe("migrateToVersion1", () => {
    it("should create all database tables", async () => {
      const result = await migrateToVersion1(db)
      expect(result.success).toBe(true)

      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table'
         AND name IN ('ingredients', 'ingredient_lists', 'domain_events', 'database_version')
         ORDER BY name;`
      )
      expect(tables.length).toBe(4)
    })

    it("should create the domain_events index", async () => {
      await migrateToVersion1(db)

      const indexes = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_domain_events_aggregate';`
      )
      expect(indexes.length).toBe(1)
    })

    it("should be idempotent (safe to run twice)", async () => {
      await migrateToVersion1(db)
      const result = await migrateToVersion1(db)
      expect(result.success).toBe(true)
    })

    it("should handle errors gracefully", async () => {
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Mock database error")
      })
      const result = await migrateToVersion1(db)
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
    })
  })

  describe("executeMigrations", () => {
    it("should run v1 and create all tables on a fresh install (currentVersion = 0)", async () => {
      const result = await executeMigrations(db, 0)
      expect(result.success).toBe(true)

      const tables = await db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table'
         AND name IN ('ingredients', 'ingredient_lists', 'domain_events');`
      )
      expect(tables.length).toBe(3)
    })

    it("should record DB_VERSION after a successful migration", async () => {
      await executeMigrations(db, 0)

      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version WHERE version = ?;`,
        DB_VERSION
      )
      expect(version?.version).toBe(DB_VERSION)
    })

    it("should skip v1 and only update version when already at v1", async () => {
      await migrateToVersion1(db)
      await db.runAsync(
        `INSERT OR REPLACE INTO database_version (version, migration_date) VALUES (1, ?)`,
        Date.now()
      )

      const result = await executeMigrations(db, 1)
      expect(result.success).toBe(true)
    })

    it("should reset legacy version (currentVersion > 1) to DB_VERSION", async () => {
      // Legacy user: tables already exist from old migration system
      await migrateToVersion1(db)
      await db.runAsync(
        `INSERT OR REPLACE INTO database_version (version, migration_date) VALUES (6, ?)`,
        Date.now()
      )

      const result = await executeMigrations(db, 6)
      expect(result.success).toBe(true)

      const version = await db.getFirstAsync<{ version: number }>(
        `SELECT version FROM database_version ORDER BY version DESC LIMIT 1;`
      )
      expect(version?.version).toBe(DB_VERSION)
    })

    it("should return a DbMigrationError when a migration fails", async () => {
      jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
        throw new Error("Mock database error")
      })

      const result = await executeMigrations(db, 0)
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbMigrationError)
    })
  })
})
