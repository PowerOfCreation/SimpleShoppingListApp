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
    seq: null,
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
        payload TEXT NOT NULL,
        seq INTEGER
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

  describe("getByAggregateType", () => {
    it("filters by aggregate_type", async () => {
      await repo.append(
        makeEvent({ event_id: "e1", aggregate_type: AggregateTypes.INGREDIENT })
      )
      await repo.append(
        makeEvent({ event_id: "e2", aggregate_type: AggregateTypes.TODO_LIST })
      )
      await repo.append(
        makeEvent({ event_id: "e3", aggregate_type: AggregateTypes.INGREDIENT })
      )

      const result = await repo.getByAggregateType(AggregateTypes.INGREDIENT)

      expect(result.success).toBe(true)
      expect(result.getValue()!.map((e) => e.event_id)).toEqual(["e1", "e3"])
    })

    it("orders confirmed (seq set) events by seq, ahead of unconfirmed ones", async () => {
      // append() never persists seq (local writes are always unconfirmed) -
      // insertRemote is what a confirmed event actually looks like on disk.
      await repo.append(makeEvent({ event_id: "unconfirmed" }))
      await repo.insertRemote(makeEvent({ event_id: "seq-30", seq: 30 }))
      await repo.insertRemote(makeEvent({ event_id: "seq-10", seq: 10 }))

      const result = await repo.getByAggregateType(AggregateTypes.INGREDIENT)

      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "seq-10",
        "seq-30",
        "unconfirmed",
      ])
    })

    it("breaks ties among unconfirmed events by insertion order, not occurred_at", async () => {
      await repo.append(makeEvent({ event_id: "first", occurred_at: 2000 }))
      await repo.append(makeEvent({ event_id: "second", occurred_at: 1000 }))

      const result = await repo.getByAggregateType(AggregateTypes.INGREDIENT)

      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "first",
        "second",
      ])
    })
  })

  describe("getByListId", () => {
    it("returns todo_list.* and ingredient.* events sharing a list_id", async () => {
      await repo.append(
        makeEvent({
          event_id: "ingredient",
          aggregate_type: AggregateTypes.INGREDIENT,
          list_id: "list-1",
        })
      )
      await repo.append(
        makeEvent({
          event_id: "list",
          aggregate_type: AggregateTypes.TODO_LIST,
          list_id: "list-1",
        })
      )
      await repo.append(
        makeEvent({ event_id: "other-list", list_id: "list-2" })
      )

      const result = await repo.getByListId("list-1")

      expect(result.success).toBe(true)
      expect(
        result
          .getValue()!
          .map((e) => e.event_id)
          .sort()
      ).toEqual(["ingredient", "list"])
    })

    it("orders confirmed (seq set) events by seq, ahead of our own unconfirmed writes", async () => {
      // seq is the server's authoritative order; occurred_at is deliberately
      // misleading here to prove it plays no role.
      await repo.append(makeEvent({ event_id: "unconfirmed", occurred_at: 1 }))
      await repo.insertRemote(
        makeEvent({ event_id: "seq-20", occurred_at: 9999, seq: 20 })
      )
      await repo.insertRemote(
        makeEvent({ event_id: "seq-10", occurred_at: 5000, seq: 10 })
      )

      const result = await repo.getByListId("list-1")

      expect(result.getValue()!.map((e) => e.event_id)).toEqual([
        "seq-10",
        "seq-20",
        "unconfirmed",
      ])
    })
  })

  describe("markSeq", () => {
    it("sets seq on an event that doesn't have one yet", async () => {
      await repo.append(makeEvent({ event_id: "e1" }))

      const result = await repo.markSeq("e1", 42)

      expect(result.success).toBe(true)
      const row = await db.getFirstAsync<{ seq: number }>(
        `SELECT seq FROM domain_events WHERE event_id = 'e1'`
      )
      expect(row?.seq).toBe(42)
    })

    it("is a no-op when the event already has a seq", async () => {
      await repo.insertRemote(makeEvent({ event_id: "e1", seq: 1 }))

      const result = await repo.markSeq("e1", 2)

      expect(result.success).toBe(true)
      const row = await db.getFirstAsync<{ seq: number }>(
        `SELECT seq FROM domain_events WHERE event_id = 'e1'`
      )
      expect(row?.seq).toBe(1)
    })
  })

  describe("insertRemote / appendRemote", () => {
    it("insertRemote inserts a new event and reports 1 row changed", async () => {
      const changes = await repo.insertRemote(
        makeEvent({ event_id: "e1", seq: 1 })
      )

      expect(changes).toBe(1)
      const row = await db.getFirstAsync(
        `SELECT * FROM domain_events WHERE event_id = 'e1'`
      )
      expect(row).not.toBeNull()
    })

    it("is idempotent, reporting 0 changes for an event already present with the same seq", async () => {
      await repo.insertRemote(makeEvent({ event_id: "e1", seq: 1 }))

      const changes = await repo.insertRemote(
        makeEvent({ event_id: "e1", seq: 1 })
      )

      expect(changes).toBe(0)
      const count = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM domain_events`
      )
      expect(count?.c).toBe(1)
    })

    it("fills in the seq of an unconfirmed local event and reports it as changed", async () => {
      // An echo of our own push: the local write is already in the log
      // with seq NULL, and the pulled copy carries the seq it was
      // assigned - insertRemote must adopt it rather than ignore it.
      await repo.append(makeEvent({ event_id: "e1" }))

      const changes = await repo.insertRemote(
        makeEvent({ event_id: "e1", seq: 7 })
      )

      expect(changes).toBe(1)
      const row = await db.getFirstAsync<{ seq: number }>(
        `SELECT seq FROM domain_events WHERE event_id = 'e1'`
      )
      expect(row?.seq).toBe(7)
    })

    it("appendRemote inserts a batch in one transaction and reports how many were new", async () => {
      const result = await repo.appendRemote([
        makeEvent({ event_id: "e1", seq: 1 }),
        makeEvent({ event_id: "e2", seq: 2 }),
      ])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual({ applied: 2 })
    })

    it("appendRemote never writes to the outbox", async () => {
      const outboxRepo = new OutboxRepository(db)

      await repo.appendRemote([makeEvent({ event_id: "e1", seq: 1 })])

      const pending = await outboxRepo.getPending()
      expect(pending.getValue()).toEqual([])
    })

    it("appendRemote counts only the genuinely new rows in a mixed batch", async () => {
      await repo.insertRemote(makeEvent({ event_id: "e1", seq: 1 }))

      const result = await repo.appendRemote([
        makeEvent({ event_id: "e1", seq: 1 }), // already present, same seq
        makeEvent({ event_id: "e2", seq: 2 }), // new
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
