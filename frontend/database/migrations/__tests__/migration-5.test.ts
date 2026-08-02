import * as SQLite from "expo-sqlite"
import { migrateToVersion5 } from "../migration-5"
import { getDatabase } from "@/database/database"
import { DbMigrationError } from "@/api/common/error-types"
import { EventTypes } from "@/types/DomainEvent"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return {
    ...originalModule,
    DB_NAME: ":memory:",
  }
})

describe("migrateToVersion5", () => {
  let db: SQLite.SQLiteDatabase

  beforeEach(async () => {
    db = getDatabase()
    await db.execAsync(`
      DROP TABLE IF EXISTS sync_cursors;
      DROP TABLE IF EXISTS domain_events;
      DROP TABLE IF EXISTS ingredients;
      CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        list_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)
  })

  async function insertEvent(row: {
    event_id: string
    event_type: string
    aggregate_id: string
    aggregate_type: string
    payload: string
  }) {
    await db.runAsync(
      `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, occurred_at, client_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.event_id,
      row.event_type,
      row.aggregate_id,
      row.aggregate_type,
      1000,
      "client-1",
      row.payload
    )
  }

  async function listIdOf(eventId: string): Promise<string | null> {
    const row = await db.getFirstAsync<{ list_id: string | null }>(
      `SELECT list_id FROM domain_events WHERE event_id = ?`,
      eventId
    )
    return row?.list_id ?? null
  }

  it("backfills list_id = aggregate_id for todo_list.* events", async () => {
    await insertEvent({
      event_id: "e1",
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: "list-1",
      aggregate_type: "todo_list",
      payload: JSON.stringify({ name: "Rewe" }),
    })

    const result = await migrateToVersion5(db)

    expect(result.success).toBe(true)
    expect(await listIdOf("e1")).toBe("list-1")
  })

  it("backfills list_id from the listId in an ingredient.created payload", async () => {
    await insertEvent({
      event_id: "e1",
      event_type: EventTypes.INGREDIENT_CREATED,
      aggregate_id: "ing-1",
      aggregate_type: "ingredient",
      payload: JSON.stringify({ name: "Milk", listId: "list-1" }),
    })

    await migrateToVersion5(db)

    expect(await listIdOf("e1")).toBe("list-1")
  })

  it("resolves other ingredient.* events by joining back to their ingredient.created event", async () => {
    await insertEvent({
      event_id: "created",
      event_type: EventTypes.INGREDIENT_CREATED,
      aggregate_id: "ing-1",
      aggregate_type: "ingredient",
      payload: JSON.stringify({ name: "Milk", listId: "list-1" }),
    })
    await insertEvent({
      event_id: "updated",
      event_type: EventTypes.INGREDIENT_UPDATED,
      aggregate_id: "ing-1",
      aggregate_type: "ingredient",
      payload: JSON.stringify({ name: "Whole Milk" }),
    })

    await migrateToVersion5(db)

    expect(await listIdOf("updated")).toBe("list-1")
  })

  it("falls back to the ingredients projection when the created event is missing", async () => {
    await insertEvent({
      event_id: "priority_set",
      event_type: EventTypes.INGREDIENT_PRIORITY_SET,
      aggregate_id: "ing-1",
      aggregate_type: "ingredient",
      payload: JSON.stringify({ priority: 1 }),
    })
    await db.runAsync(
      `INSERT INTO ingredients (id, name, completed, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      "ing-1",
      "Milk",
      0,
      "list-1",
      1000,
      1000
    )

    await migrateToVersion5(db)

    expect(await listIdOf("priority_set")).toBe("list-1")
  })

  it("leaves list_id NULL when no source can resolve it", async () => {
    await insertEvent({
      event_id: "orphan",
      event_type: EventTypes.INGREDIENT_DELETED,
      aggregate_id: "ing-ghost",
      aggregate_type: "ingredient",
      payload: "{}",
    })

    const result = await migrateToVersion5(db)

    expect(result.success).toBe(true)
    expect(await listIdOf("orphan")).toBeNull()
  })

  it("creates the sync_cursors table", async () => {
    await migrateToVersion5(db)

    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='sync_cursors';`
    )
    expect(tables.length).toBe(1)
  })

  it("creates the domain_events list_id index", async () => {
    await migrateToVersion5(db)

    const indexes = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_domain_events_list';`
    )
    expect(indexes.length).toBe(1)
  })

  it("is idempotent (safe to run twice)", async () => {
    await insertEvent({
      event_id: "e1",
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: "list-1",
      aggregate_type: "todo_list",
      payload: JSON.stringify({ name: "Rewe" }),
    })

    const first = await migrateToVersion5(db)
    const second = await migrateToVersion5(db)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(await listIdOf("e1")).toBe("list-1")
  })

  it("handles errors gracefully", async () => {
    jest.spyOn(db, "withTransactionAsync").mockImplementationOnce(() => {
      throw new Error("Mock database error")
    })
    const result = await migrateToVersion5(db)
    expect(result.success).toBe(false)
    expect(result.getError()).toBeInstanceOf(DbMigrationError)
  })
})
