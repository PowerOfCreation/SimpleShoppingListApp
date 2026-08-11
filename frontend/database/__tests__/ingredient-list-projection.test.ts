import * as SQLite from "expo-sqlite"
import { IngredientListProjection } from "../ingredient-list-projection"
import { getDatabase } from "../database"
import { AggregateTypes, DomainEventRow, EventTypes } from "@/types/DomainEvent"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

const makeEvent = (
  overrides: Partial<DomainEventRow> = {}
): DomainEventRow => ({
  event_id: "evt-1",
  event_type: EventTypes.TODO_LIST_CREATED,
  aggregate_id: "list-1",
  aggregate_type: AggregateTypes.TODO_LIST,
  list_id: "list-1",
  occurred_at: 1000,
  client_id: "client-1",
  payload: JSON.stringify({ name: "Rewe" }),
  seq: null,
  ...overrides,
})

describe("IngredientListProjection", () => {
  let db: SQLite.SQLiteDatabase
  let projection: IngredientListProjection

  beforeEach(async () => {
    db = getDatabase()
    projection = new IngredientListProjection(db)

    // No sync_enabled column here - that setting moved to
    // list_sync_settings, a device-local table the projection never
    // touches (see list-sync-settings-repository.ts).
    await db.execAsync(`DROP TABLE IF EXISTS ingredient_lists`)
    await db.execAsync(`
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  })

  describe("handleCreated", () => {
    it("inserts a list", async () => {
      await projection.handleCreated(db, makeEvent())

      const row = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row).not.toBeNull()
    })
  })

  describe("rebuild", () => {
    it("replays created + updated + deleted as before", async () => {
      await projection.rebuild([
        makeEvent({
          event_id: "e1",
          event_type: EventTypes.TODO_LIST_CREATED,
          occurred_at: 1000,
        }),
        makeEvent({
          event_id: "e2",
          event_type: EventTypes.TODO_LIST_UPDATED,
          occurred_at: 2000,
          payload: JSON.stringify({ name: "Lidl" }),
        }),
      ])

      const row = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row?.name).toBe("Lidl")
    })

    it("clears ingredient_lists before replaying", async () => {
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES ('stale', 'Stale', 1, 1)`
      )

      await projection.rebuild([])

      const rows = await db.getAllAsync(`SELECT * FROM ingredient_lists`)
      expect(rows.length).toBe(0)
    })

    it("ignores a sync_enabled/sync_disabled event still sitting in old history", async () => {
      // Historical rows: these event types are no longer emitted (see
      // types/DomainEvent.ts), but old ones may still exist in a device's
      // domain_events. The projection must not choke on them.
      await projection.rebuild([
        makeEvent({
          event_id: "e1",
          event_type: EventTypes.TODO_LIST_CREATED,
          occurred_at: 1000,
        }),
        makeEvent({
          event_id: "e2",
          event_type: EventTypes.TODO_LIST_SYNC_ENABLED,
          occurred_at: 1000,
        }),
      ])

      const row = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row).not.toBeNull()
    })
  })

  describe("rebuildForList", () => {
    it("clears and replays only the given list, leaving other lists untouched", async () => {
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES ('list-2', 'Other', 1, 1)`
      )

      await projection.rebuildForList(db, "list-1", [
        makeEvent({ event_id: "e1", occurred_at: 1000 }),
      ])

      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ingredient_lists ORDER BY id`
      )
      expect(rows.map((r) => r.id)).toEqual(["list-1", "list-2"])
    })

    it("leaves no row when the list's history ends in a delete", async () => {
      await projection.rebuildForList(db, "list-1", [
        makeEvent({
          event_id: "e1",
          event_type: EventTypes.TODO_LIST_CREATED,
          occurred_at: 1000,
        }),
        makeEvent({
          event_id: "e2",
          event_type: EventTypes.TODO_LIST_DELETED,
          occurred_at: 2000,
          payload: "{}",
        }),
      ])

      const row = await db.getFirstAsync(
        `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row).toBeNull()
    })

    it("does not open its own transaction - safe to call from within an existing one", async () => {
      await db.withTransactionAsync(async () => {
        await projection.rebuildForList(db, "list-1", [makeEvent()])
      })

      const row = await db.getFirstAsync(
        `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row).not.toBeNull()
    })

    it("replays confirmed events by seq regardless of the input array's order", async () => {
      const created = makeEvent({
        event_id: "e1",
        event_type: EventTypes.TODO_LIST_CREATED,
        seq: 1,
      })
      const renamed = makeEvent({
        event_id: "e2",
        event_type: EventTypes.TODO_LIST_UPDATED,
        payload: JSON.stringify({ name: "Lidl" }),
        seq: 2,
      })

      // Passed newest-first - rebuildForList must sort before replaying.
      await projection.rebuildForList(db, "list-1", [renamed, created])

      const row = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM ingredient_lists WHERE id = 'list-1'`
      )
      expect(row?.name).toBe("Lidl")
    })
  })
})
