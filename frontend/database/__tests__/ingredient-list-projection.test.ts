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
  ...overrides,
})

describe("IngredientListProjection", () => {
  let db: SQLite.SQLiteDatabase
  let projection: IngredientListProjection

  beforeEach(async () => {
    db = getDatabase()
    projection = new IngredientListProjection(db)

    await db.execAsync(`DROP TABLE IF EXISTS ingredient_lists`)
    await db.execAsync(`
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_enabled INTEGER NOT NULL DEFAULT 0
      )
    `)
  })

  async function getSyncEnabled(id: string): Promise<number | undefined> {
    const row = await db.getFirstAsync<{ sync_enabled: number }>(
      `SELECT sync_enabled FROM ingredient_lists WHERE id = ?`,
      id
    )
    return row?.sync_enabled
  }

  describe("handleCreated", () => {
    it("inserts a list with sync_enabled defaulting to 0", async () => {
      await projection.handleCreated(db, makeEvent())

      expect(await getSyncEnabled("list-1")).toBe(0)
    })
  })

  describe("handleSyncEnabled / handleSyncDisabled", () => {
    it("flips sync_enabled to 1 and back to 0", async () => {
      await projection.handleCreated(db, makeEvent())

      await projection.handleSyncEnabled(
        db,
        makeEvent({ event_type: EventTypes.TODO_LIST_SYNC_ENABLED })
      )
      expect(await getSyncEnabled("list-1")).toBe(1)

      await projection.handleSyncDisabled(
        db,
        makeEvent({ event_type: EventTypes.TODO_LIST_SYNC_DISABLED })
      )
      expect(await getSyncEnabled("list-1")).toBe(0)
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

    it("preserves sync_enabled across a rebuild instead of silently disabling it", async () => {
      // This is the regression a naive rebuild() introduces: DELETE FROM
      // ingredient_lists wipes sync_enabled along with everything else, and
      // handleCreated never sets it (it's always a follow-up event). If
      // rebuild()'s switch doesn't also replay sync_enabled/sync_disabled
      // events, every synced list comes back from a rebuild with sync
      // silently turned off.
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

      expect(await getSyncEnabled("list-1")).toBe(1)
    })

    it("replays a later sync_disabled after sync_enabled", async () => {
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
        makeEvent({
          event_id: "e3",
          event_type: EventTypes.TODO_LIST_SYNC_DISABLED,
          occurred_at: 2000,
        }),
      ])

      expect(await getSyncEnabled("list-1")).toBe(0)
    })

    it("clears ingredient_lists before replaying", async () => {
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES ('stale', 'Stale', 1, 1)`
      )

      await projection.rebuild([])

      const rows = await db.getAllAsync(`SELECT * FROM ingredient_lists`)
      expect(rows.length).toBe(0)
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

    it("replays sync_enabled/sync_disabled so a rebuild doesn't silently disable sync", async () => {
      await projection.rebuildForList(db, "list-1", [
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

      expect(await getSyncEnabled("list-1")).toBe(1)
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

    it("replays in (occurred_at, event_id) order regardless of the input array's order", async () => {
      const created = makeEvent({
        event_id: "e1",
        event_type: EventTypes.TODO_LIST_CREATED,
        occurred_at: 1000,
      })
      const renamed = makeEvent({
        event_id: "e2",
        event_type: EventTypes.TODO_LIST_UPDATED,
        occurred_at: 2000,
        payload: JSON.stringify({ name: "Lidl" }),
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
