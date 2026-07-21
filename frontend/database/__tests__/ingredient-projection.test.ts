import * as SQLite from "expo-sqlite"
import { IngredientProjection } from "../ingredient-projection"
import { getDatabase } from "../database"
import { EventTypes } from "@/types/DomainEvent"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

const makeEvent = (
  overrides: Partial<{
    event_id: string
    event_type: string
    aggregate_id: string
    aggregate_type: string
    occurred_at: number
    client_id: string
    payload: string
  }> = {}
) => ({
  event_id: "evt-1",
  event_type: EventTypes.INGREDIENT_CREATED,
  aggregate_id: "ing-1",
  aggregate_type: "ingredient",
  occurred_at: 1000,
  client_id: "client-1",
  payload: JSON.stringify({
    name: "Milk",
    listId: "list-1",
    completed: false,
    completedAt: null,
  }),
  ...overrides,
})

describe("IngredientProjection", () => {
  let db: SQLite.SQLiteDatabase
  let projection: IngredientProjection

  beforeEach(async () => {
    db = getDatabase()
    projection = new IngredientProjection(db)

    await db.execAsync(`DROP TABLE IF EXISTS ingredients`)
    await db.execAsync(`
      CREATE TABLE ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        list_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        priority INTEGER
      )
    `)
  })

  describe("handleCreated", () => {
    it("inserts a row with correct data", async () => {
      await projection.handleCreated(db, makeEvent())

      const row = await db.getFirstAsync<{
        id: string
        name: string
        completed: number
        list_id: string
        created_at: number
        updated_at: number
        completed_at: number | null
      }>(`SELECT * FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toMatchObject({
        id: "ing-1",
        name: "Milk",
        completed: 0,
        list_id: "list-1",
        created_at: 1000,
        updated_at: 1000,
        completed_at: null,
      })
    })
  })

  describe("handleUpdated", () => {
    beforeEach(async () => {
      await db.execAsync(
        `INSERT INTO ingredients VALUES ('ing-1','Milk',0,'list-1',1000,1000,NULL,NULL)`
      )
    })

    it("updates the name when payload contains name", async () => {
      await projection.handleUpdated(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_UPDATED,
          occurred_at: 2000,
          payload: JSON.stringify({ name: "Oat Milk" }),
        })
      )

      const row = await db.getFirstAsync<{ name: string; updated_at: number }>(
        `SELECT name, updated_at FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row).toEqual({ name: "Oat Milk", updated_at: 2000 })
    })

    it("updates completion and completedAt when payload contains completed", async () => {
      await projection.handleUpdated(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_UPDATED,
          occurred_at: 3000,
          payload: JSON.stringify({ completed: true, completedAt: 3000 }),
        })
      )

      const row = await db.getFirstAsync<{
        completed: number
        completed_at: number | null
        updated_at: number
      }>(
        `SELECT completed, completed_at, updated_at FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row).toEqual({
        completed: 1,
        completed_at: 3000,
        updated_at: 3000,
      })
    })

    it("sets completedAt to null when uncompleting", async () => {
      await db.execAsync(
        `UPDATE ingredients SET completed=1, completed_at=3000 WHERE id='ing-1'`
      )

      await projection.handleUpdated(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_UPDATED,
          occurred_at: 4000,
          payload: JSON.stringify({ completed: false, completedAt: null }),
        })
      )

      const row = await db.getFirstAsync<{
        completed: number
        completed_at: number | null
      }>(`SELECT completed, completed_at FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ completed: 0, completed_at: null })
    })
  })

  describe("handlePrioritySet", () => {
    beforeEach(async () => {
      await db.execAsync(
        `INSERT INTO ingredients VALUES ('ing-1','Milk',0,'list-1',1000,1000,NULL,NULL)`
      )
    })

    it("updates priority and updated_at", async () => {
      await projection.handlePrioritySet(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_PRIORITY_SET,
          occurred_at: 2500,
          payload: JSON.stringify({ priority: 100 }),
        })
      )

      const row = await db.getFirstAsync<{
        priority: number | null
        updated_at: number
      }>(`SELECT priority, updated_at FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ priority: 100, updated_at: 2500 })
    })

    it("does not touch name or completed", async () => {
      await projection.handlePrioritySet(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_PRIORITY_SET,
          occurred_at: 2500,
          payload: JSON.stringify({ priority: 0 }),
        })
      )

      const row = await db.getFirstAsync<{
        name: string
        completed: number
      }>(`SELECT name, completed FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ name: "Milk", completed: 0 })
    })
  })

  describe("handleDeleted", () => {
    it("removes the row", async () => {
      await db.execAsync(
        `INSERT INTO ingredients VALUES ('ing-1','Milk',0,'list-1',1000,1000,NULL,NULL)`
      )

      await projection.handleDeleted(
        db,
        makeEvent({ event_type: EventTypes.INGREDIENT_DELETED })
      )

      const row = await db.getFirstAsync(
        `SELECT id FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row).toBeNull()
    })
  })

  describe("rebuild", () => {
    it("clears existing data and replays all event types", async () => {
      await db.execAsync(
        `INSERT INTO ingredients VALUES ('stale','Old',0,'list-1',1,1,NULL,NULL)`
      )

      const events = [
        makeEvent({
          event_id: "e1",
          event_type: EventTypes.INGREDIENT_CREATED,
          aggregate_id: "a",
          occurred_at: 1000,
          payload: JSON.stringify({
            name: "Apples",
            listId: "list-1",
            completed: false,
            completedAt: null,
          }),
        }),
        makeEvent({
          event_id: "e2",
          event_type: EventTypes.INGREDIENT_CREATED,
          aggregate_id: "b",
          occurred_at: 2000,
          payload: JSON.stringify({
            name: "Butter",
            listId: "list-1",
            completed: false,
            completedAt: null,
          }),
        }),
        makeEvent({
          event_id: "e3",
          event_type: EventTypes.INGREDIENT_UPDATED,
          aggregate_id: "a",
          occurred_at: 3000,
          payload: JSON.stringify({ name: "Green Apples" }),
        }),
        makeEvent({
          event_id: "e4",
          event_type: EventTypes.INGREDIENT_PRIORITY_SET,
          aggregate_id: "a",
          occurred_at: 3500,
          payload: JSON.stringify({ priority: 200 }),
        }),
        makeEvent({
          event_id: "e5",
          event_type: EventTypes.INGREDIENT_DELETED,
          aggregate_id: "b",
          occurred_at: 4000,
          payload: "{}",
        }),
      ]

      await projection.rebuild(events)

      const rows = await db.getAllAsync<{
        id: string
        name: string
        priority: number | null
      }>(`SELECT id, name, priority FROM ingredients ORDER BY id`)
      expect(rows).toEqual([{ id: "a", name: "Green Apples", priority: 200 }])
    })
  })
})
