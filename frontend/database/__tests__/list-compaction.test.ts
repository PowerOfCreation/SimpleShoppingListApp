import * as SQLite from "expo-sqlite"
import {
  compactListToEvents,
  CompactionContext,
  CompactionSource,
} from "../list-compaction"
import { IngredientListProjection } from "../ingredient-list-projection"
import { IngredientProjection } from "../ingredient-projection"
import { getDatabase } from "../database"
import { EventTypes, SYNCABLE_EVENT_TYPES } from "@/types/DomainEvent"
import { Ingredient } from "@/types/Ingredient"
import { Priority } from "@/types/Priority"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "ing-1",
    name: "Milk",
    completed: false,
    list_id: "list-1",
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeContext(
  overrides: Partial<CompactionContext> = {}
): CompactionContext {
  let counter = 0
  return {
    newId: () => `evt-${++counter}`,
    ingredientIdFor: (i) => i.id,
    occurredAt: 5000,
    clientId: "client-1",
    ...overrides,
  }
}

describe("compactListToEvents", () => {
  it("emits todo_list.created first, addressed to the target list", () => {
    const events = compactListToEvents(
      { listId: "list-1", name: "Rewe", ingredients: [] },
      makeContext()
    )

    expect(events[0]).toMatchObject({
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: "list-1",
      aggregate_type: "todo_list",
      list_id: "list-1",
      occurred_at: 5000,
      client_id: "client-1",
      seq: null,
    })
    expect(JSON.parse(events[0].payload)).toEqual({ name: "Rewe" })
  })

  it("emits exactly one event for an empty list", () => {
    const events = compactListToEvents(
      { listId: "list-1", name: "Rewe", ingredients: [] },
      makeContext()
    )
    expect(events).toHaveLength(1)
  })

  it("emits one ingredient.created per ingredient, scoped to the target list", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [
        makeIngredient({ id: "a", name: "Milk" }),
        makeIngredient({ id: "b", name: "Bread" }),
      ],
    }
    const events = compactListToEvents(source, makeContext())

    const created = events.filter(
      (e) => e.event_type === EventTypes.INGREDIENT_CREATED
    )
    expect(created).toHaveLength(2)
    expect(created.every((e) => e.list_id === "list-1")).toBe(true)
    expect(created.map((e) => JSON.parse(e.payload).name)).toEqual([
      "Milk",
      "Bread",
    ])
  })

  it("folds a completed ingredient's state into its created payload", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ completed: true, completed_at: 4242 })],
    }
    const events = compactListToEvents(source, makeContext())

    const payload = JSON.parse(events[1].payload)
    expect(payload).toMatchObject({ completed: true, completedAt: 4242 })
  })

  it("uses completed: false, completedAt: null for an open ingredient", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ completed: false })],
    }
    const events = compactListToEvents(source, makeContext())

    const payload = JSON.parse(events[1].payload)
    expect(payload).toMatchObject({ completed: false, completedAt: null })
  })

  it("emits an ingredient.priority_set right after created for a prioritized ingredient", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ priority: Priority.NOW })],
    }
    const events = compactListToEvents(source, makeContext())

    expect(events).toHaveLength(3)
    expect(events[2]).toMatchObject({
      event_type: EventTypes.INGREDIENT_PRIORITY_SET,
      aggregate_id: "ing-1",
    })
    expect(JSON.parse(events[2].payload)).toEqual({ priority: Priority.NOW })
  })

  it("emits no priority_set for an ingredient without a priority", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ priority: undefined })],
    }
    const events = compactListToEvents(source, makeContext())

    expect(
      events.some((e) => e.event_type === EventTypes.INGREDIENT_PRIORITY_SET)
    ).toBe(false)
  })

  it("never emits updated/deleted/priority_cleared event types", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [
        makeIngredient({ id: "a", completed: true, priority: Priority.NOW }),
        makeIngredient({ id: "b" }),
      ],
    }
    const events = compactListToEvents(source, makeContext())

    const forbidden: string[] = [
      EventTypes.TODO_LIST_UPDATED,
      EventTypes.TODO_LIST_DELETED,
      EventTypes.INGREDIENT_UPDATED,
      EventTypes.INGREDIENT_DELETED,
      EventTypes.INGREDIENT_PRIORITY_CLEARED,
    ]
    expect(events.some((e) => forbidden.includes(e.event_type))).toBe(false)
  })

  it("only ever emits event types that are syncable", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ priority: Priority.NOW })],
    }
    const events = compactListToEvents(source, makeContext())

    expect(
      events.every((e) => SYNCABLE_EVENT_TYPES.includes(e.event_type))
    ).toBe(true)
  })

  it("mints every event_id from newId and keeps them unique", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ id: "a", priority: Priority.NOW })],
    }
    const events = compactListToEvents(source, makeContext())

    const ids = events.map((e) => e.event_id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(["evt-1", "evt-2", "evt-3"])
  })

  it("marks every event as unconfirmed (seq: null)", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ priority: Priority.NOW })],
    }
    const events = compactListToEvents(source, makeContext())
    expect(events.every((e) => e.seq === null)).toBe(true)
  })

  it("assigns ingredient ids via ingredientIdFor, not the source ingredient's id", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ id: "original-id" })],
    }
    const events = compactListToEvents(
      source,
      makeContext({ ingredientIdFor: () => "fresh-id" })
    )

    const created = events.find(
      (e) => e.event_type === EventTypes.INGREDIENT_CREATED
    )!
    expect(created.aggregate_id).toBe("fresh-id")
  })

  it("uses the ingredient's own created_at as occurred_at when present", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ created_at: 111 })],
    }
    const events = compactListToEvents(source, makeContext({ occurredAt: 999 }))

    const created = events.find(
      (e) => e.event_type === EventTypes.INGREDIENT_CREATED
    )!
    expect(created.occurred_at).toBe(111)
  })

  it("falls back to ctx.occurredAt when the ingredient has no created_at", () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [makeIngredient({ created_at: undefined })],
    }
    const events = compactListToEvents(source, makeContext({ occurredAt: 999 }))

    const created = events.find(
      (e) => e.event_type === EventTypes.INGREDIENT_CREATED
    )!
    expect(created.occurred_at).toBe(999)
  })
})

describe("compactListToEvents - replay round-trip", () => {
  let db: SQLite.SQLiteDatabase
  let listProjection: IngredientListProjection
  let ingredientProjection: IngredientProjection

  beforeEach(async () => {
    db = getDatabase()
    listProjection = new IngredientListProjection(db)
    ingredientProjection = new IngredientProjection(db)

    await db.execAsync(`DROP TABLE IF EXISTS ingredient_lists`)
    await db.execAsync(`
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
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

  // The actual correctness proof: replaying the generated events through the
  // real projections (rebuildForList, the same dispatcher a pull uses) must
  // reproduce the source projection exactly - §6.1 "Vorwärts-Anwendung ==
  // Rebuild" testform.
  it("reproduces the source list's projection when replayed with identity ids", async () => {
    const source: CompactionSource = {
      listId: "list-1",
      name: "Rewe",
      ingredients: [
        makeIngredient({
          id: "a",
          name: "Milk",
          completed: true,
          completed_at: 2000,
          created_at: 1500,
          priority: Priority.DAYS_1_TO_3,
        }),
        makeIngredient({
          id: "b",
          name: "Bread",
          completed: false,
          created_at: 1600,
        }),
      ],
    }
    const events = compactListToEvents(
      source,
      makeContext({ occurredAt: 5000 })
    )

    await listProjection.rebuildForList(db, "list-1", events)
    await ingredientProjection.rebuildForList(db, "list-1", events)

    const list = await db.getFirstAsync<{ id: string; name: string }>(
      `SELECT id, name FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list).toMatchObject({ id: "list-1", name: "Rewe" })

    const rows = await db.getAllAsync<{
      id: string
      name: string
      completed: number
      completed_at: number | null
      priority: number | null
      created_at: number
    }>(`SELECT * FROM ingredients WHERE list_id = 'list-1' ORDER BY id`)

    expect(rows).toEqual([
      expect.objectContaining({
        id: "a",
        name: "Milk",
        completed: 1,
        completed_at: 2000,
        priority: Priority.DAYS_1_TO_3,
        created_at: 1500,
      }),
      expect.objectContaining({
        id: "b",
        name: "Bread",
        completed: 0,
        completed_at: null,
        priority: null,
        created_at: 1600,
      }),
    ])
  })

  it("targets a fresh list id and ingredient ids without touching the source", async () => {
    // Seed a pre-existing source list/ingredient to prove it's untouched.
    await listProjection.handleCreated(db, {
      event_id: "src-evt",
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: "list-1",
      aggregate_type: "todo_list",
      list_id: "list-1",
      occurred_at: 1000,
      client_id: "client-1",
      payload: JSON.stringify({ name: "Rewe" }),
      seq: null,
    })

    const source: CompactionSource = {
      listId: "list-2",
      name: "Rewe (Copy)",
      ingredients: [makeIngredient({ id: "a", name: "Milk" })],
    }
    let counter = 0
    const events = compactListToEvents(source, {
      newId: () => `evt-${++counter}`,
      ingredientIdFor: () => "fresh-ingredient-id",
      occurredAt: 6000,
      clientId: "client-1",
    })

    await listProjection.rebuildForList(db, "list-2", events)
    await ingredientProjection.rebuildForList(db, "list-2", events)

    const copy = await db.getFirstAsync<{ id: string; name: string }>(
      `SELECT id, name FROM ingredient_lists WHERE id = 'list-2'`
    )
    expect(copy).toMatchObject({ id: "list-2", name: "Rewe (Copy)" })

    const source_ = await db.getFirstAsync<{ id: string; name: string }>(
      `SELECT id, name FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(source_).toMatchObject({ id: "list-1", name: "Rewe" })

    const copiedIngredient = await db.getFirstAsync<{
      id: string
      list_id: string
    }>(`SELECT id, list_id FROM ingredients WHERE list_id = 'list-2'`)
    expect(copiedIngredient).toMatchObject({
      id: "fresh-ingredient-id",
      list_id: "list-2",
    })
  })
})
