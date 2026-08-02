import * as SQLite from "expo-sqlite"
import { EventRepository } from "../event-repository"
import { OutboxRepository } from "../outbox-repository"
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
    list_id: "list-1",
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
        list_id TEXT,
        occurred_at INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `)
    await db.execAsync(`DROP TABLE IF EXISTS event_outbox`)
    await db.execAsync(`
      CREATE TABLE event_outbox (
        event_id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        created_at INTEGER NOT NULL
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

  describe("appendAll", () => {
    it("commits every event, projection, and outbox row in one transaction", async () => {
      const projected: string[] = []
      const outboxRepo = new OutboxRepository(db)

      const result = await repo.appendAll([
        {
          event: makeEvent({ event_id: "e1" }),
          project: async () => {
            projected.push("e1")
          },
          enqueueForSync: true,
        },
        {
          event: makeEvent({ event_id: "e2" }),
          project: async () => {
            projected.push("e2")
          },
        },
      ])

      expect(result.success).toBe(true)
      expect(projected).toEqual(["e1", "e2"])

      const eventCount = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(eventCount?.c).toBe(2)

      const pending = await outboxRepo.getPending()
      // Only the entry with enqueueForSync: true should have an outbox row.
      expect(pending.getValue()!.map((r) => r.event_id)).toEqual(["e1"])
    })

    it("rolls back everything - events, projections, and outbox rows - if any entry throws", async () => {
      const outboxRepo = new OutboxRepository(db)

      const result = await repo.appendAll([
        { event: makeEvent({ event_id: "e1" }), enqueueForSync: true },
        {
          event: makeEvent({ event_id: "e2" }),
          project: async () => {
            throw new Error("projection failed")
          },
          enqueueForSync: true,
        },
      ])

      expect(result.success).toBe(false)

      const eventCount = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(eventCount?.c).toBe(0)

      const pending = await outboxRepo.getPending()
      expect(pending.getValue()).toEqual([])
    })
  })

  describe("getByEventIds", () => {
    it("returns full event rows preserving the caller's requested order", async () => {
      await repo.append(makeEvent({ event_id: "e1", occurred_at: 1000 }))
      await repo.append(makeEvent({ event_id: "e2", occurred_at: 2000 }))
      await repo.append(makeEvent({ event_id: "e3", occurred_at: 3000 }))

      // Deliberately out of SQL/insertion order - the result must follow
      // the ids as given, since callers (the sync engine) pass ids already
      // in the order they must be sent.
      const result = await repo.getByEventIds(["e3", "e1"])

      expect(result.getValue()!.map((e) => e.event_id)).toEqual(["e3", "e1"])
    })

    it("silently drops ids that don't exist", async () => {
      await repo.append(makeEvent({ event_id: "e1" }))

      const result = await repo.getByEventIds(["e1", "missing"])

      expect(result.getValue()!.map((e) => e.event_id)).toEqual(["e1"])
    })

    it("returns an empty array for an empty id list without querying", async () => {
      const spy = jest.spyOn(db, "getAllAsync")

      const result = await repo.getByEventIds([])

      expect(result.getValue()).toEqual([])
      expect(spy).not.toHaveBeenCalled()
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

    it("breaks ties on occurred_at by insertion order", async () => {
      // Same millisecond is easy to hit in practice (e.g. create + a
      // follow-up event emitted in the same service call). occurred_at
      // alone is not a stable sort key, so insertion order (rowid) must
      // decide - otherwise a create could be replayed after its own update.
      await repo.append(
        makeEvent({
          event_id: "created",
          aggregate_id: "agg-1",
          occurred_at: 1000,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "updated",
          aggregate_id: "agg-1",
          occurred_at: 1000,
        })
      )

      const result = await repo.getByAggregateId("agg-1")

      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "created",
        "updated",
      ])
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

    it("breaks ties on occurred_at by insertion order", async () => {
      await repo.append(
        makeEvent({
          event_id: "e1",
          aggregate_type: AggregateTypes.TODO_LIST,
          occurred_at: 1000,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "e2",
          aggregate_type: AggregateTypes.TODO_LIST,
          occurred_at: 1000,
        })
      )

      const result = await repo.getByAggregateType(AggregateTypes.TODO_LIST)

      expect(result.getValue()!.map((e) => e.event_id)).toEqual(["e1", "e2"])
    })
  })

  describe("getByListId", () => {
    it("returns todo_list.* and ingredient.* events sharing a list_id, ordered by (occurred_at, event_id)", async () => {
      await repo.append(
        makeEvent({
          event_id: "b-ingredient",
          aggregate_type: AggregateTypes.INGREDIENT,
          list_id: "list-1",
          occurred_at: 1000,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "a-list",
          aggregate_type: AggregateTypes.TODO_LIST,
          list_id: "list-1",
          occurred_at: 1000,
        })
      )
      await repo.append(
        makeEvent({
          event_id: "other-list",
          list_id: "list-2",
          occurred_at: 500,
        })
      )

      const result = await repo.getByListId("list-1")

      expect(result.success).toBe(true)
      // Same occurred_at - tiebreak is event_id, not insertion order, unlike
      // getByAggregateId's rowid tiebreak (this must be device-independent).
      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "a-list",
        "b-ingredient",
      ])
    })
  })

  describe("insertRemote / appendRemote", () => {
    it("insertRemote inserts a new event and reports 1 row changed", async () => {
      const changes = await repo.insertRemote(makeEvent({ event_id: "e1" }))

      expect(changes).toBe(1)
      const row = await db.getFirstAsync(
        `SELECT * FROM domain_events WHERE event_id = 'e1'`
      )
      expect(row).not.toBeNull()
    })

    it("insertRemote is idempotent, reporting 0 changes for an event already present", async () => {
      await repo.insertRemote(makeEvent({ event_id: "e1" }))

      const changes = await repo.insertRemote(makeEvent({ event_id: "e1" }))

      expect(changes).toBe(0)
      const count = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(count?.c).toBe(1)
    })

    it("appendRemote inserts a batch in one transaction and reports how many were new", async () => {
      const result = await repo.appendRemote([
        makeEvent({ event_id: "e1" }),
        makeEvent({ event_id: "e2" }),
      ])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual({ applied: 2 })
    })

    it("appendRemote never writes to the outbox", async () => {
      const outboxRepo = new OutboxRepository(db)

      await repo.appendRemote([makeEvent({ event_id: "e1" })])

      const pending = await outboxRepo.getPending()
      expect(pending.getValue()).toEqual([])
    })

    it("appendRemote counts only the genuinely new rows in a mixed batch", async () => {
      await repo.append(makeEvent({ event_id: "e1" }))

      const result = await repo.appendRemote([
        makeEvent({ event_id: "e1" }), // already present locally
        makeEvent({ event_id: "e2" }), // new
      ])

      expect(result.getValue()).toEqual({ applied: 1 })
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
