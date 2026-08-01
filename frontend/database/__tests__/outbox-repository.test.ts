import * as SQLite from "expo-sqlite"
import { OutboxRepository } from "../outbox-repository"
import { getDatabase } from "../database"

jest.mock("../database", () => {
  const originalModule = jest.requireActual("../database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

describe("OutboxRepository", () => {
  let db: SQLite.SQLiteDatabase
  let repo: OutboxRepository

  beforeEach(async () => {
    db = getDatabase()
    repo = new OutboxRepository(db)

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

  describe("enqueue", () => {
    it("inserts a pending row", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)

      const result = await repo.getPending()
      expect(result.getValue()).toEqual([
        {
          event_id: "evt-1",
          aggregate_id: "agg-1",
          status: "pending",
          attempts: 0,
          last_attempt_at: null,
          created_at: 1000,
        },
      ])
    })

    it("enqueueing the same event_id twice is a no-op, not a crash", async () => {
      // Turning sync on for a list more than once replays its whole
      // history into the outbox each time - re-enqueueing an event that's
      // already queued must not violate the primary key.
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.markSynced("evt-1")

      await expect(
        repo.enqueue(db, "evt-1", "agg-1", 1000)
      ).resolves.toBeUndefined()

      // Stays synced - re-enqueueing does not reset status.
      const pending = await repo.getPending()
      expect(pending.getValue()).toEqual([])
    })
  })

  describe("getPending", () => {
    it("only returns pending rows, oldest first", async () => {
      await repo.enqueue(db, "evt-2", "agg-1", 2000)
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-3", "agg-1", 3000)
      await repo.markSynced("evt-3")

      const result = await repo.getPending()
      expect(result.getValue()!.map((r) => r.event_id)).toEqual([
        "evt-1",
        "evt-2",
      ])
    })

    it("respects the limit", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-2", "agg-1", 2000)

      const result = await repo.getPending(1)
      expect(result.getValue()!.length).toBe(1)
    })
  })

  describe("markSynced", () => {
    it("moves a row out of getPending", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)

      const result = await repo.markSynced("evt-1")
      expect(result.success).toBe(true)

      const pending = await repo.getPending()
      expect(pending.getValue()).toEqual([])
    })

    it("is a no-op, not a failure, when the row no longer exists", async () => {
      // Simulates an ack arriving for a row already removed by
      // cancelForAggregate (sync toggled off mid-flight).
      const result = await repo.markSynced("never-enqueued")
      expect(result.success).toBe(true)
    })
  })

  describe("bumpAttempt", () => {
    it("increments attempts and records last_attempt_at", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)

      await repo.bumpAttempt("evt-1", 5000)
      await repo.bumpAttempt("evt-1", 6000)

      const row = await db.getFirstAsync<{
        attempts: number
        last_attempt_at: number
      }>(
        `SELECT attempts, last_attempt_at FROM event_outbox WHERE event_id = 'evt-1'`
      )
      expect(row?.attempts).toBe(2)
      expect(row?.last_attempt_at).toBe(6000)
    })
  })

  describe("resetToPending", () => {
    it("moves synced rows back to pending (the self-heal path)", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.markSynced("evt-1")

      await repo.resetToPending(["evt-1"])

      const pending = await repo.getPending()
      expect(pending.getValue()!.map((r) => r.event_id)).toEqual(["evt-1"])
    })

    it("is a no-op for an empty list", async () => {
      const result = await repo.resetToPending([])
      expect(result.success).toBe(true)
    })
  })

  describe("cancelForAggregate", () => {
    it("removes only pending rows for the aggregate", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-2", "agg-1", 2000)
      await repo.enqueue(db, "evt-3", "agg-2", 3000)
      await repo.markSynced("evt-2")

      await repo.cancelForAggregate("agg-1")

      const all = await db.getAllAsync<{ event_id: string }>(
        `SELECT event_id FROM event_outbox ORDER BY event_id`
      )
      // evt-1 (pending, agg-1) removed; evt-2 (synced, agg-1) kept;
      // evt-3 (pending, agg-2) untouched.
      expect(all.map((r) => r.event_id)).toEqual(["evt-2", "evt-3"])
    })
  })
})
