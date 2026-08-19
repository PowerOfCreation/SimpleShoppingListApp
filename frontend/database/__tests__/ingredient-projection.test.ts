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
    list_id: string | null
    occurred_at: number
    client_id: string
    payload: string
    seq: number | null
  }> = {}
) => ({
  event_id: "evt-1",
  event_type: EventTypes.INGREDIENT_CREATED,
  aggregate_id: "ing-1",
  aggregate_type: "ingredient",
  list_id: "list-1",
  occurred_at: 1000,
  client_id: "client-1",
  seq: null,
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

    it("skips (doesn't throw) when the payload is not valid JSON", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleCreated(db, makeEvent({ payload: "{not json" }))
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync(`SELECT id FROM ingredients`)
      expect(row).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it("skips (doesn't throw) when a required field is missing", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleCreated(db, makeEvent({ payload: "{}" }))
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync(`SELECT id FROM ingredients`)
      expect(row).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    // The server authorizes writes on the envelope's list_id, not anything
    // inside payload - a payload-carried listId must never be trusted, or a
    // member of list Y could push an event authorized for Y that lands in
    // list X locally.
    it("uses the envelope's list_id, ignoring a divergent payload.listId", async () => {
      await projection.handleCreated(
        db,
        makeEvent({
          list_id: "list-Y",
          payload: JSON.stringify({
            name: "Milk",
            listId: "list-X",
            completed: false,
          }),
        })
      )

      const row = await db.getFirstAsync<{ list_id: string }>(
        `SELECT list_id FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row?.list_id).toBe("list-Y")
    })

    it("is idempotent: applying the same created event twice updates in place instead of throwing", async () => {
      await projection.handleCreated(db, makeEvent())

      await expect(
        projection.handleCreated(
          db,
          makeEvent({
            payload: JSON.stringify({
              name: "Whole Milk",
              listId: "list-1",
              completed: true,
              completedAt: 2000,
            }),
          })
        )
      ).resolves.toBeUndefined()

      const rows = await db.getAllAsync(`SELECT id FROM ingredients`)
      expect(rows).toHaveLength(1)
      const row = await db.getFirstAsync<{ name: string; completed: number }>(
        `SELECT name, completed FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row).toEqual({ name: "Whole Milk", completed: 1 })
    })

    it("skips (doesn't throw) when completed has the wrong type", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleCreated(
          db,
          makeEvent({
            payload: JSON.stringify({ name: "Milk", completed: "yes" }),
          })
        )
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync(`SELECT id FROM ingredients`)
      expect(row).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it("skips (doesn't throw) when completedAt has the wrong type", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleCreated(
          db,
          makeEvent({
            payload: JSON.stringify({
              name: "Milk",
              completed: true,
              completedAt: "not-a-timestamp",
            }),
          })
        )
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync(`SELECT id FROM ingredients`)
      expect(row).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
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

    it("skips (doesn't throw) when completed has the wrong type", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleUpdated(
          db,
          makeEvent({
            event_type: EventTypes.INGREDIENT_UPDATED,
            occurred_at: 3000,
            payload: JSON.stringify({ completed: "yes", completedAt: 3000 }),
          })
        )
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync<{
        completed: number
        updated_at: number
      }>(`SELECT completed, updated_at FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ completed: 0, updated_at: 1000 })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it("skips (doesn't throw) when completedAt has the wrong type", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.handleUpdated(
          db,
          makeEvent({
            event_type: EventTypes.INGREDIENT_UPDATED,
            occurred_at: 3000,
            payload: JSON.stringify({
              completed: true,
              completedAt: "not-a-timestamp",
            }),
          })
        )
      ).resolves.toBeUndefined()

      const row = await db.getFirstAsync<{
        completed: number
        updated_at: number
      }>(`SELECT completed, updated_at FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ completed: 0, updated_at: 1000 })
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
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

  describe("handlePriorityCleared", () => {
    beforeEach(async () => {
      await db.execAsync(
        `INSERT INTO ingredients VALUES ('ing-1','Milk',0,'list-1',1000,1000,NULL,100)`
      )
    })

    it("sets priority back to null and updates updated_at", async () => {
      await projection.handlePriorityCleared(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_PRIORITY_CLEARED,
          occurred_at: 2600,
          payload: "{}",
        })
      )

      const row = await db.getFirstAsync<{
        priority: number | null
        updated_at: number
      }>(`SELECT priority, updated_at FROM ingredients WHERE id = 'ing-1'`)
      expect(row).toEqual({ priority: null, updated_at: 2600 })
    })

    it("does not touch name or completed", async () => {
      await projection.handlePriorityCleared(
        db,
        makeEvent({
          event_type: EventTypes.INGREDIENT_PRIORITY_CLEARED,
          occurred_at: 2600,
          payload: "{}",
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
        makeEvent({
          event_id: "e6",
          event_type: EventTypes.INGREDIENT_PRIORITY_CLEARED,
          aggregate_id: "a",
          occurred_at: 4500,
          payload: "{}",
        }),
      ]

      await projection.rebuild(events)

      const rows = await db.getAllAsync<{
        id: string
        name: string
        priority: number | null
      }>(`SELECT id, name, priority FROM ingredients ORDER BY id`)
      expect(rows).toEqual([{ id: "a", name: "Green Apples", priority: null }])
    })
  })

  describe("rebuildForList", () => {
    it("clears only the given list's ingredients, leaving other lists untouched", async () => {
      await db.execAsync(`
        INSERT INTO ingredients VALUES ('a','A',0,'list-1',1,1,NULL,NULL);
        INSERT INTO ingredients VALUES ('other','Other',0,'list-2',1,1,NULL,NULL);
      `)

      await projection.rebuildForList(db, "list-1", [
        makeEvent({
          event_id: "e1",
          event_type: EventTypes.INGREDIENT_CREATED,
          aggregate_id: "b",
          list_id: "list-1",
          occurred_at: 1000,
          payload: JSON.stringify({
            name: "Bread",
            listId: "list-1",
            completed: false,
            completedAt: null,
          }),
        }),
      ])

      const rows = await db.getAllAsync<{ id: string; list_id: string }>(
        `SELECT id, list_id FROM ingredients ORDER BY id`
      )
      expect(rows).toEqual([
        { id: "b", list_id: "list-1" },
        { id: "other", list_id: "list-2" },
      ])
    })

    it("replays confirmed events by seq regardless of the input array's order", async () => {
      const created = makeEvent({
        event_id: "e1",
        event_type: EventTypes.INGREDIENT_CREATED,
        aggregate_id: "a",
        list_id: "list-1",
        seq: 1,
        payload: JSON.stringify({
          name: "Milk",
          listId: "list-1",
          completed: false,
          completedAt: null,
        }),
      })
      const updated = makeEvent({
        event_id: "e2",
        event_type: EventTypes.INGREDIENT_UPDATED,
        aggregate_id: "a",
        list_id: "list-1",
        seq: 2,
        payload: JSON.stringify({ name: "Whole Milk" }),
      })

      // Passed newest-first - rebuildForList must sort before replaying.
      await projection.rebuildForList(db, "list-1", [updated, created])

      const row = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM ingredients WHERE id = 'a'`
      )
      expect(row?.name).toBe("Whole Milk")
    })

    it("does not open its own transaction - safe to call from within an existing one", async () => {
      await db.withTransactionAsync(async () => {
        await projection.rebuildForList(db, "list-1", [makeEvent()])
      })

      const row = await db.getFirstAsync(
        `SELECT id FROM ingredients WHERE id = 'ing-1'`
      )
      expect(row).not.toBeNull()
    })

    // Regression test for the poison-pill bug: a corrupt event mid-history
    // used to throw out of rebuildForList, out of EventApplier's
    // transaction, and leave the pull cursor stuck forever on this list.
    // With totality, the bad event is skipped and every valid event either
    // side of it still applies.
    it("skips a corrupt event mid-history instead of aborting the whole rebuild", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await expect(
        projection.rebuildForList(db, "list-1", [
          makeEvent({
            event_id: "e1",
            event_type: EventTypes.INGREDIENT_CREATED,
            aggregate_id: "a",
            seq: 1,
            payload: JSON.stringify({ name: "Apples", completed: false }),
          }),
          makeEvent({
            event_id: "e2",
            event_type: EventTypes.INGREDIENT_CREATED,
            aggregate_id: "b",
            seq: 2,
            payload: "{not valid json",
          }),
          makeEvent({
            event_id: "e3",
            event_type: EventTypes.INGREDIENT_CREATED,
            aggregate_id: "c",
            seq: 3,
            payload: JSON.stringify({ name: "Butter", completed: false }),
          }),
        ])
      ).resolves.toBeUndefined()

      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ingredients ORDER BY id`
      )
      // a and c (valid) both applied; only the corrupt b in between was
      // skipped.
      expect(rows.map((r) => r.id)).toEqual(["a", "c"])
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    // Task 3: skipped events must be diagnosable through the same path as
    // the existing drift case, not just a per-event log line - see
    // SyncEngine.repairList.
    it("warns with a repairList pointer summarizing how many events were skipped", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation()

      await projection.rebuildForList(db, "list-1", [
        makeEvent({ event_id: "e1", seq: 1 }),
        makeEvent({
          event_id: "e2",
          event_type: EventTypes.INGREDIENT_PRIORITY_SET,
          aggregate_id: "ing-1",
          payload: "{}",
          seq: 2,
        }),
      ])

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /skipped 1 unreadable event.*SyncEngine\.repairList/
        )
      )

      warnSpy.mockRestore()
    })

    // A DB write failure is infrastructure, not unreadable content - unlike
    // a bad payload (skipped above), it must propagate out of rebuildForList
    // so EventApplier.apply's transaction rolls back and the cursor doesn't
    // advance past an event that never actually applied.
    it("propagates a genuine db write failure instead of swallowing it like a bad payload", async () => {
      const dbError = new Error("SQLITE_BUSY: database is locked")
      const originalRunAsync = db.runAsync.bind(db)
      let callCount = 0
      jest
        .spyOn(db, "runAsync")
        .mockImplementation((...args: Parameters<typeof db.runAsync>) => {
          callCount++
          // 1st call is rebuildForList's own DELETE; 2nd is handleCreated's
          // INSERT - fail that one specifically.
          if (callCount === 2) {
            return Promise.reject(dbError)
          }
          return originalRunAsync(...args)
        })

      await expect(
        projection.rebuildForList(db, "list-1", [makeEvent()])
      ).rejects.toThrow(dbError)

      jest.restoreAllMocks()
    })
  })
})
