import * as SQLite from "expo-sqlite"
import { EventRepository } from "../event-repository"
import { getDatabase } from "../database"
import { AggregateTypes, DomainEventRow, EventTypes } from "@/types/DomainEvent"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

const makeEvent = (overrides: Partial<DomainEventRow> = {}) => ({
  ...baseEvent(),
  ...overrides,
})

function baseEvent() {
  return {
    event_id: "evt-1",
    event_type: EventTypes.INGREDIENT_CREATED,
    aggregate_id: "agg-1",
    aggregate_type: AggregateTypes.INGREDIENT,
    occurred_at: 1000,
    client_id: "client-1",
    payload: "{}",
  }
}

describe("EventRepository", () => {
  let db: SQLite.SQLiteDatabase
  let repo: EventRepository

  beforeEach(async () => {
    db = getDatabase()
    repo = new EventRepository(db)

    await db.execAsync(`DROP TABLE IF EXISTS domain_events`)
    await db.execAsync(`
      CREATE TABLE domain_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `)
  })

  describe("append", () => {
    it("persists an event", async () => {
      const result = await repo.append(makeEvent())

      expect(result.success).toBe(true)
      const row = await db.getFirstAsync<DomainEventRow>(
        `SELECT * FROM domain_events WHERE event_id = 'evt-1'`
      )
      expect(row).toMatchObject({ event_id: "evt-1", aggregate_id: "agg-1" })
    })
  })

  describe("appendWithProjection", () => {
    it("inserts the event and calls the projection callback", async () => {
      const projected: string[] = []
      const result = await repo.appendWithProjection(makeEvent(), async () => {
        projected.push("called")
      })

      expect(result.success).toBe(true)
      expect(projected).toEqual(["called"])
      const count = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(count?.c).toBe(1)
    })

    it("rolls back the event if the projection throws", async () => {
      const result = await repo.appendWithProjection(makeEvent(), async () => {
        throw new Error("projection failed")
      })

      expect(result.success).toBe(false)
      const count = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(count?.c).toBe(0)
    })
  })

  describe("getByAggregateId", () => {
    it("returns events for the given aggregate ordered by occurred_at ASC", async () => {
      await repo.append(
        makeEvent({ event_id: "e2", aggregate_id: "agg-1", occurred_at: 2000 })
      )
      await repo.append(
        makeEvent({ event_id: "e1", aggregate_id: "agg-1", occurred_at: 1000 })
      )
      await repo.append(
        makeEvent({ event_id: "e3", aggregate_id: "other", occurred_at: 500 })
      )

      const result = await repo.getByAggregateId("agg-1")

      expect(result.success).toBe(true)
      const events = result.getValue()!
      expect(events.map((e) => e.event_id)).toEqual(["e1", "e2"])
    })
  })

  describe("getByAggregateType", () => {
    it("filters by aggregate_type and orders by occurred_at ASC", async () => {
      await repo.append(
        makeEvent({
          event_id: "e1",
          aggregate_type: AggregateTypes.INGREDIENT,
          occurred_at: 1000,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "e2",
          aggregate_type: AggregateTypes.TODO_LIST,
          occurred_at: 500,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "e3",
          aggregate_type: AggregateTypes.INGREDIENT,
          occurred_at: 2000,
        })
      )

      const result = await repo.getByAggregateType(AggregateTypes.INGREDIENT)

      expect(result.success).toBe(true)
      expect(result.getValue()!.map((e) => e.event_id)).toEqual(["e1", "e3"])
    })
  })

  describe("getAll", () => {
    it("returns all events ordered by occurred_at DESC", async () => {
      await repo.append(makeEvent({ event_id: "e1", occurred_at: 1000 }))
      await repo.append(makeEvent({ event_id: "e2", occurred_at: 3000 }))
      await repo.append(makeEvent({ event_id: "e3", occurred_at: 2000 }))

      const result = await repo.getAll()

      expect(result.success).toBe(true)
      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "e2",
        "e3",
        "e1",
      ])
    })
  })
})
