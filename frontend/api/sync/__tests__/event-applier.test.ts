import * as SQLite from "expo-sqlite"
import { EventApplier } from "../event-applier"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { getDatabase } from "@/database/database"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"
import {
  notifyListDataChanged,
  notifySyncListsChanged,
} from "@/api/sync/sync-events"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})

jest.mock("@/api/sync/sync-events", () => ({
  notifyListDataChanged: jest.fn(),
  notifySyncListsChanged: jest.fn(),
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
  let listSyncSettingsRepository: ListSyncSettingsRepository
  let cursorRepository: SyncCursorRepository
  let applier: EventApplier

  beforeEach(async () => {
    jest.clearAllMocks()
    db = getDatabase()
    eventRepository = new EventRepository(db)
    ingredientProjection = new IngredientProjection(db)
    listProjection = new IngredientListProjection(db)
    listSyncSettingsRepository = new ListSyncSettingsRepository(db)
    cursorRepository = new SyncCursorRepository(db)
    applier = new EventApplier(
      db,
      eventRepository,
      ingredientProjection,
      listProjection,
      cursorRepository,
      listSyncSettingsRepository
    )

    await db.execAsync(`
      DROP TABLE IF EXISTS domain_events;
      DROP TABLE IF EXISTS event_outbox;
      DROP TABLE IF EXISTS ingredients;
      DROP TABLE IF EXISTS ingredient_lists;
      DROP TABLE IF EXISTS sync_cursors;
      DROP TABLE IF EXISTS list_sync_settings;
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
      CREATE TABLE list_sync_settings (
        list_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
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
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)`,
      "list-1",
      1,
      Date.now()
    )

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

    const syncSetting = await db.getFirstAsync(
      `SELECT list_id FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(syncSetting).toBeNull()
    expect(notifySyncListsChanged).toHaveBeenCalled()
  })

  it("keeps the sync setting and does not notify when the list is merely missing its created event", async () => {
    // A history with no todo_list.created also leaves no row in
    // ingredient_lists after rebuild - the same symptom as an actual
    // deletion, but this list is repairable (see #230's repairList) and
    // must not be silently dropped out of getEnabledIds().
    await db.runAsync(
      `INSERT INTO list_sync_settings (list_id, enabled, updated_at) VALUES (?, ?, ?)`,
      "list-1",
      1,
      Date.now()
    )

    const result = await applier.apply("list-1", [makeIngredientCreated()], 5)

    expect(result.success).toBe(true)

    const list = await db.getFirstAsync(
      `SELECT id FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list).toBeNull()

    const syncSetting = await db.getFirstAsync(
      `SELECT list_id FROM list_sync_settings WHERE list_id = 'list-1'`
    )
    expect(syncSetting).not.toBeNull()
    expect(notifySyncListsChanged).not.toHaveBeenCalled()
  })

  // Poison-pill regression: a corrupt payload used to throw out of the
  // projection rebuild, out of this transaction, and get caught by apply()
  // as a failure - leaving the cursor stuck so the next pull re-fetched the
  // same corrupt page forever. With total projections, the bad event is
  // just skipped: apply() still succeeds, the cursor still advances, and
  // every other event in the page (and the next page) still applies.
  it("doesn't abort on a corrupt payload mid-page - the rest of the page still applies and the cursor advances", async () => {
    const corruptIngredient = makeIngredientCreated({
      event_id: "ing-corrupt",
      aggregate_id: "ing-bad",
      occurred_at: 1500,
      payload: "{not valid json",
    })

    const result = await applier.apply(
      "list-1",
      [makeEvent(), corruptIngredient, makeIngredientCreated()],
      5
    )

    expect(result.success).toBe(true)
    expect(result.getValue()).toEqual({ applied: 3 })

    const list = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM ingredient_lists WHERE id = 'list-1'`
    )
    expect(list?.name).toBe("Rewe")

    const goodIngredient = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM ingredients WHERE id = 'ing-1'`
    )
    expect(goodIngredient?.name).toBe("Milk")

    const badIngredient = await db.getFirstAsync(
      `SELECT id FROM ingredients WHERE id = 'ing-bad'`
    )
    expect(badIngredient).toBeNull()

    const cursorRow = await db.getFirstAsync<{ last_seen_seq: number }>(
      `SELECT last_seen_seq FROM sync_cursors WHERE list_id = 'list-1'`
    )
    expect(cursorRow?.last_seen_seq).toBe(5)

    // The next pull for this list must not be stuck repeating the same
    // page - a fresh page applies cleanly and the cursor keeps advancing.
    const followUp = await applier.apply(
      "list-1",
      [
        makeEvent({
          event_id: "e-followup",
          event_type: EventTypes.TODO_LIST_UPDATED,
          occurred_at: 2000,
          payload: JSON.stringify({ name: "Lidl" }),
        }),
      ],
      9
    )
    expect(followUp.success).toBe(true)

    const cursorAfterFollowUp = await db.getFirstAsync<{
      last_seen_seq: number
    }>(`SELECT last_seen_seq FROM sync_cursors WHERE list_id = 'list-1'`)
    expect(cursorAfterFollowUp?.last_seen_seq).toBe(9)
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
