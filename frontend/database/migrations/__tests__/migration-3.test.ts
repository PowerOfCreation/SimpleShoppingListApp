import * as SQLite from "expo-sqlite"
import { migrateToVersion3 } from "../migration-3"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion3", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS ingredients;
      CREATE TABLE ingredients (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL
      );
    `)
  })

  it("adds the priority column to ingredients", async () => {
    const result = await migrateToVersion3(db)

    expect(result.success).toBe(true)
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(ingredients);`
    )
    expect(columns.some((c) => c.name === "priority")).toBe(true)
  })

  it("is idempotent (safe to run twice)", async () => {
    const first = await migrateToVersion3(db)
    const second = await migrateToVersion3(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion3(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
