import { setPreference, getPreference } from "../preferences-repository"
import { getDatabase } from "../database"
import * as writeLock from "../write-lock"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

describe("preferences-repository", () => {
  beforeEach(async () => {
    const db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS app_preferences;
      CREATE TABLE app_preferences (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  })

  it("writes and reads back a preference", async () => {
    await setPreference("foo", "bar")
    expect(await getPreference("foo")).toBe("bar")
  })

  it("returns null for a key that was never set", async () => {
    expect(await getPreference("missing")).toBeNull()
  })

  it("overwrites an existing value for the same key", async () => {
    await setPreference("foo", "first")
    await setPreference("foo", "second")
    expect(await getPreference("foo")).toBe("second")
  })

  // setPreference is now a background-write path (sync flush/pull persist
  // list permission state through it - see list-sync-status.ts), so its
  // write has to be serialized through the same connection-wide lock every
  // other writer uses - see write-lock.ts for what breaks otherwise.
  it("serializes its write through the shared write-lock", async () => {
    const spy = jest.spyOn(writeLock, "runExclusive")

    await setPreference("foo", "bar")

    expect(spy).toHaveBeenCalled()
  })
})
