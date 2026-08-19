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
    await db.execAsync(`DROP TABLE IF EXISTS domain_events`)
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
  })

  async function insertDomainEvent(eventId: string, listId: string | null) {
    await db.runAsync(
      `INSERT INTO domain_events (event_id, event_type, aggregate_id, aggregate_type, list_id, occurred_at, client_id, payload)
       VALUES (?, 'ingredient.created', 'ing-1', 'ingredient', ?, 1000, 'client-1', '{}')`,
      eventId,
      listId
    )
  }

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
      await repo.markSynced(["evt-1"])

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
      await repo.markSynced(["evt-3"])

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

    it("keyset-paginates via `after` past a page already seen", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-2", "agg-1", 1000)
      await repo.enqueue(db, "evt-3", "agg-1", 2000)

      const firstPage = await repo.getPending(2)
      expect(firstPage.getValue()!.map((r) => r.event_id)).toEqual([
        "evt-1",
        "evt-2",
      ])

      const lastOfFirstPage = firstPage.getValue()!.at(-1)!.event_id
      const secondPage = await repo.getPending(2, lastOfFirstPage)
      expect(secondPage.getValue()!.map((r) => r.event_id)).toEqual(["evt-3"])
    })

    it("returns an empty page when `after` no longer exists (raced by a cancel)", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)

      const result = await repo.getPending(50, "already-removed")

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })
  })

  describe("markSynced", () => {
    it("moves the confirmed rows out of getPending", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-2", "agg-1", 1001)

      const result = await repo.markSynced(["evt-1", "evt-2"])
      expect(result.success).toBe(true)

      const pending = await repo.getPending()
      expect(pending.getValue()).toEqual([])
    })

    it("leaves rows the push did not confirm pending", async () => {
      await repo.enqueue(db, "evt-1", "agg-1", 1000)
      await repo.enqueue(db, "evt-2", "agg-1", 1001)

      await repo.markSynced(["evt-1"])

      const pending = await repo.getPending()
      expect(pending.getValue()!.map((row) => row.event_id)).toEqual(["evt-2"])
    })

    it("is a no-op, not a failure, when a row no longer exists", async () => {
      // Simulates a confirmation arriving for a row already removed by
      // cancelForList (sync toggled off mid-flight).
      const result = await repo.markSynced(["never-enqueued"])
      expect(result.success).toBe(true)
    })

    it("is a no-op for an empty confirmation list", async () => {
      const result = await repo.markSynced([])
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
      await repo.markSynced(["evt-1"])

      await repo.resetToPending(["evt-1"])

      const pending = await repo.getPending()
      expect(pending.getValue()!.map((r) => r.event_id)).toEqual(["evt-1"])
    })

    it("is a no-op for an empty list", async () => {
      const result = await repo.resetToPending([])
      expect(result.success).toBe(true)
    })
  })

  describe("cancelForList", () => {
    it("removes only pending rows for events belonging to the list, ingredient rows included", async () => {
      // evt-1/evt-2 belong to list-1 (via domain_events.list_id); evt-3
      // belongs to a different list entirely.
      await insertDomainEvent("evt-1", "list-1")
      await insertDomainEvent("evt-2", "list-1")
      await insertDomainEvent("evt-3", "list-2")

      await repo.enqueue(db, "evt-1", "ing-1", 1000)
      await repo.enqueue(db, "evt-2", "ing-2", 2000)
      await repo.enqueue(db, "evt-3", "ing-3", 3000)
      await repo.markSynced(["evt-2"])

      await repo.cancelForList("list-1")

      const all = await db.getAllAsync<{ event_id: string }>(
        `SELECT event_id FROM event_outbox ORDER BY event_id`
      )
      // evt-1 (pending, list-1) removed; evt-2 (synced, list-1) kept;
      // evt-3 (pending, list-2) untouched.
      expect(all.map((r) => r.event_id)).toEqual(["evt-2", "evt-3"])
    })

    it("does nothing when the list has no outbox rows", async () => {
      const result = await repo.cancelForList("no-such-list")
      expect(result.success).toBe(true)
    })
  })
})
