import * as SQLite from "expo-sqlite"
import { migrateToVersion1 } from "../migration-1"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion1", () => {
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
