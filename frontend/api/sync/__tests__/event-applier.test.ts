import * as SQLite from "expo-sqlite"
import { EventApplier } from "../event-applier"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { getDatabase } from "@/database/database"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"
import { notifyListDataChanged } from "@/api/sync/sync-events"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

jest.mock("@/api/sync/sync-events", () => ({
  notifyListDataChanged: jest.fn(),
}))

const makeEvent = (
  overrides: Partial<DomainEventRow> = {}
): DomainEventRow => ({
  event_id: "evt-1",
  event_type: EventTypes.TODO_LIST_CREATED,
  aggregate_id: "list-1",
  aggregate_type: "todo_list",
  list_id: "list-1",
  occurred_at: 1000,
  client_id: "client-1",
  payload: JSON.stringify({ name: "Rewe" }),
  seq: null,
  ...overrides,
})

const makeIngredientCreated = (
  overrides: Partial<DomainEventRow> = {}
): DomainEventRow => ({
  event_id: "ing-created",
  event_type: EventTypes.INGREDIENT_CREATED,
  aggregate_id: "ing-1",
  aggregate_type: "ingredient",
  list_id: "list-1",
  occurred_at: 1000,
  client_id: "client-1",
  payload: JSON.stringify({ name: "Milk", listId: "list-1" }),
  seq: null,
  ...overrides,
})

describe("EventApplier", () => {
  let db: SQLite.SQLiteDatabase
  let eventRepository: EventRepository
  let ingredientProjection: IngredientProjection
  let listProjection: IngredientListProjection
  let cursorRepository: SyncCursorRepository
  let applier: EventApplier

  beforeEach(async () => {
    jest.clearAllMocks()
    db = getDatabase()
    eventRepository = new EventRepository(db)
    ingredientProjection = new IngredientProjection(db)
    listProjection = new IngredientListProjection(db)
    cursorRepository = new SyncCursorRepository(db)
    applier = new EventApplier(
      db,
      eventRepository,
      ingredientProjection,
      listProjection,
      cursorRepository
    )

    await db.execAsync(`
      DROP TABLE IF EXISTS domain_events;
      DROP TABLE IF EXISTS event_outbox;
      DROP TABLE IF EXISTS ingredients;
      DROP TABLE IF EXISTS ingredient_lists;
      DROP TABLE IF EXISTS sync_cursors;
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
      );
      CREATE TABLE event_outbox (
        event_id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE ingredient_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        list_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        priority INTEGER,
        FOREIGN KEY (list_id) REFERENCES ingredient_lists(id) ON DELETE CASCADE
      );
      CREATE TABLE sync_cursors (
        list_id TEXT PRIMARY KEY,
        last_seen_seq INTEGER NOT NULL DEFAULT 0,
        last_pulled_at INTEGER
      );
    `)
  })

  it("inserts new events, rebuilds both projections, and advances the cursor", async () => {
    const result = await applier.apply(
      "list-1",
      [makeEvent(), makeIngredientCreated()],
      5
    )

    expect(result.success).toBe(true)
    expect(result.getValue()).toEqual({ applied: 2 })

    const list = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list?.name).toBe("Rewe")

    const ingredient = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM ingredients WHERE id = 'ing-1'`
    )
    expect(ingredient?.name).toBe("Milk")

    const cursorRow = await db.getFirstAsync<{ last_seen_seq: number }>(
      `SELECT last_seen_seq FROM sync_cursors WHERE list_id = 'list-1'`
    )
    expect(cursorRow?.last_seen_seq).toBe(5)

    expect(notifyListDataChanged).toHaveBeenCalledWith("list-1")
  })

  it("is idempotent: re-applying the same page is a pure echo that only advances the cursor", async () => {
    // Real pulled events always carry the seq the server assigned them -
    // insertRemote's "already present" check is keyed on that, not just
    // presence, so the fixtures need one for this to be a genuine no-op.
    const events = [makeEvent({ seq: 0 }), makeIngredientCreated({ seq: 1 })]
    await applier.apply("list-1", events, 5)
    jest.mocked(notifyListDataChanged).mockClear()

    const second = await applier.apply("list-1", events, 5)

    expect(second.success).toBe(true)
    expect(second.getValue()).toEqual({ applied: 0 })
    expect(notifyListDataChanged).not.toHaveBeenCalled()

    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM ingredients WHERE id = 'ing-1'`
    )
    expect(count?.c).toBe(1)
  })

  it("advances the cursor even on a pure echo (no new rows applied)", async () => {
    const events = [makeEvent(), makeIngredientCreated()]
    await applier.apply("list-1", events, 5)

    await applier.apply("list-1", events, 9)

    const cursorRow = await db.getFirstAsync<{ last_seen_seq: number }>(
      `SELECT last_seen_seq FROM sync_cursors WHERE list_id = 'list-1'`
    )
    expect(cursorRow?.last_seen_seq).toBe(9)
  })

  it("never enqueues pulled events into the outbox", async () => {
    await applier.apply("list-1", [makeEvent(), makeIngredientCreated()], 5)

    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM event_outbox`
    )
    expect(count?.c).toBe(0)
  })

  it("converges to the same state regardless of the array order events were pulled in", async () => {
    const created = makeIngredientCreated({ seq: 1 })
    const updated = makeEvent({
      event_id: "ing-updated",
      event_type: EventTypes.INGREDIENT_UPDATED,
      aggregate_id: "ing-1",
      aggregate_type: "ingredient",
      list_id: "list-1",
      payload: JSON.stringify({ name: "Whole Milk" }),
      seq: 2,
    })

    // Delivered out of server order - the applier must re-sort by seq
    // before replaying, not trust array order.
    await applier.apply("list-1", [makeEvent({ seq: 0 }), updated, created], 5)

    const ingredient = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM ingredients WHERE id = 'ing-1'`
    )
    expect(ingredient?.name).toBe("Whole Milk")
  })

  it("deletes ingredients and skips the ingredient rebuild when the list's history ends in a delete", async () => {
    const deleted = makeEvent({
      event_id: "list-deleted",
      event_type: EventTypes.TODO_LIST_DELETED,
      occurred_at: 2000,
      payload: "{}",
    })

    // If this incorrectly tried to re-insert the ingredient after the list
    // row is gone, the ingredients table's FK (declared above, matching
    // production) would throw and this apply() call would fail outright.
    const result = await applier.apply(
      "list-1",
      [makeEvent(), makeIngredientCreated(), deleted],
      5
    )

    expect(result.success).toBe(true)

    const list = await db.getFirstAsync(
      `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list).toBeNull()

    const ingredient = await db.getFirstAsync(
      `SELECT id FROM ingredients WHERE id = 'ing-1'`
    )
    expect(ingredient).toBeNull()
  })

  it("is atomic: a failure partway through rolls back the event inserts, projections, and cursor together", async () => {
    jest
      .spyOn(cursorRepository, "setWithin")
      .mockRejectedValueOnce(new Error("boom"))

    const result = await applier.apply(
      "list-1",
      [makeEvent(), makeIngredientCreated()],
      5
    )

    expect(result.success).toBe(false)

    const eventCount = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM domain_events`
    )
    expect(eventCount?.c).toBe(0)

    const list = await db.getFirstAsync(
      `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list).toBeNull()

    const cursorRow = await db.getFirstAsync(
      `SELECT list_id FROM sync_cursors WHERE list_id = 'list-1'`
    )
    expect(cursorRow).toBeNull()
  })
})
