import { getListSyncStatus } from "../list-sync-status"
import { getSyncStatus, onSyncStatusChanged } from "../sync-status"
import { SyncEngine, MAX_DRAIN_BATCHES, MAX_PULL_PAGES } from "../sync-engine"
import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { PushAck, SyncClient } from "@/api/sync/sync-client"
import { EventApplier } from "@/api/sync/event-applier"
import { Result } from "@/api/common/result"
import { SyncError, DbQueryError } from "@/api/common/error-types"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"
import { flushMicrotasks } from "../test-helpers"

jest.mock("@/database/database", () => {
  const originalModule = jest.requireActual("@/database/database")
  return { ...originalModule, DB_NAME: ":memory:" }
})
jest.mock("@/database/outbox-repository")
jest.mock("@/database/event-repository")
jest.mock("@/database/sync-cursor-repository")
jest.mock("@/database/list-sync-state-repository")
jest.mock("@/api/sync/sync-client")
jest.mock("@/api/sync/event-applier")

const MockOutboxRepository = OutboxRepository as jest.MockedClass<
  typeof OutboxRepository
>
const MockEventRepository = EventRepository as jest.MockedClass<
  typeof EventRepository
>
const MockSyncCursorRepository = SyncCursorRepository as jest.MockedClass<
  typeof SyncCursorRepository
>
const MockListSyncStateRepository = ListSyncStateRepository as jest.MockedClass<
  typeof ListSyncStateRepository
>
const MockSyncClient = SyncClient as jest.MockedClass<typeof SyncClient>
const MockEventApplier = EventApplier as jest.MockedClass<typeof EventApplier>

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
  payload: "{}",
  seq: null,
  ...overrides,
})

const makeOutboxRow = (eventId: string, overrides = {}) => ({
  event_id: eventId,
  aggregate_id: "list-1",
  status: "pending" as const,
  attempts: 0,
  last_attempt_at: null,
  created_at: 1000,
  ...overrides,
})

describe("SyncEngine", () => {
  let outbox: jest.Mocked<OutboxRepository>
  let events: jest.Mocked<EventRepository>
  let cursor: jest.Mocked<SyncCursorRepository>
  let listSyncState: jest.Mocked<ListSyncStateRepository>
  let client: jest.Mocked<SyncClient>
  let applier: jest.Mocked<EventApplier>
  let engine: SyncEngine

  beforeEach(() => {
    jest.clearAllMocks()

    outbox = {
      getPending: jest.fn().mockResolvedValue(Result.ok([])),
      markSynced: jest.fn().mockResolvedValue(Result.ok(undefined)),
      bumpAttempt: jest.fn().mockResolvedValue(Result.ok(undefined)),
      resetToPending: jest.fn().mockResolvedValue(Result.ok(undefined)),
      cancelForList: jest.fn().mockResolvedValue(Result.ok(undefined)),
      cancelEventIds: jest.fn().mockResolvedValue(Result.ok(undefined)),
      enqueue: jest.fn(),
    } as unknown as jest.Mocked<OutboxRepository>

    events = {
      getByEventIds: jest.fn().mockResolvedValue(Result.ok([])),
      getByListId: jest.fn().mockResolvedValue(Result.ok([])),
      enqueueExistingForSync: jest.fn().mockResolvedValue(Result.ok(undefined)),
    } as unknown as jest.Mocked<EventRepository>

    cursor = {
      get: jest.fn().mockResolvedValue(Result.ok(null)),
      set: jest.fn().mockResolvedValue(Result.ok(undefined)),
      clear: jest.fn().mockResolvedValue(Result.ok(undefined)),
    } as unknown as jest.Mocked<SyncCursorRepository>

    listSyncState = {
      setEnabled: jest.fn().mockResolvedValue(Result.ok(undefined)),
      isPermissionDenied: jest.fn().mockResolvedValue(Result.ok(false)),
      setPermissionDenied: jest.fn().mockResolvedValue(Result.ok(undefined)),
    } as unknown as jest.Mocked<ListSyncStateRepository>

    client = {
      sendEvents: jest.fn().mockResolvedValue(Result.ok([])),
      getKnownEventIds: jest.fn().mockResolvedValue(Result.ok([])),
      getListHeads: jest.fn().mockResolvedValue(Result.ok([])),
      getEventsSince: jest.fn(),
    } as unknown as jest.Mocked<SyncClient>

    applier = {
      apply: jest.fn().mockResolvedValue(Result.ok({ applied: 0 })),
    } as unknown as jest.Mocked<EventApplier>

    MockOutboxRepository.mockImplementation(() => outbox)
    MockEventRepository.mockImplementation(() => events)
    MockSyncCursorRepository.mockImplementation(() => cursor)
    MockListSyncStateRepository.mockImplementation(() => listSyncState)
    MockSyncClient.mockImplementation(() => client)
    MockEventApplier.mockImplementation(() => applier)

    engine = new SyncEngine(
      outbox,
      events,
      client,
      cursor,
      applier,
      listSyncState
    )
  })

  describe("flush", () => {
    it("does nothing when there are no pending rows", async () => {
      await engine.flush()

      expect(events.getByEventIds).not.toHaveBeenCalled()
      expect(client.sendEvents).not.toHaveBeenCalled()
    })

    it("sends pending events, bumps their attempt count and marks what the server confirmed", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.ok([{ eventId: "e1", seq: 1 }])
      )

      await engine.flush()

      expect(client.sendEvents).toHaveBeenCalledWith([
        makeEvent({ event_id: "e1" }),
      ])
      expect(outbox.bumpAttempt).toHaveBeenCalledWith("e1", expect.any(Number))
      expect(outbox.markSynced).toHaveBeenCalledWith(["e1"])
    })

    // The push commits before it answers, so anything the response doesn't
    // confirm has to stay pending - marking a row synced off the bare fact
    // that a request was sent is exactly the optimism this design rejects.
    it("does not mark a row synced when the response confirms nothing", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(Result.ok([]))

      await engine.flush()

      expect(outbox.markSynced).toHaveBeenCalledWith([])
    })

    it("ignores a confirmation for an event this group never sent", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.ok([
          { eventId: "e1", seq: 1 },
          { eventId: "someone-elses-event", seq: 2 },
        ])
      )

      await engine.flush()

      expect(outbox.markSynced).toHaveBeenCalledWith(["e1"])
    })

    // The self-heal for a lost response: the row stayed pending, the next
    // flush re-pushes it, and the server (idempotent on event_id) answers
    // with the seq it already assigned. No reconcile pass involved.
    it("marks a row synced from a redelivery that echoes the original seq", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents
        .mockResolvedValueOnce(
          Result.fail(new SyncError("Network error while sending events", true))
        )
        .mockResolvedValueOnce(Result.ok([{ eventId: "e1", seq: 1 }]))

      await engine.flush()
      expect(outbox.markSynced).not.toHaveBeenCalled()

      await engine.flush()
      expect(outbox.markSynced).toHaveBeenCalledWith(["e1"])
    })

    it("still bumps attempts when the send fails, but does not throw", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await expect(engine.flush()).resolves.toBe(false)
      expect(outbox.bumpAttempt).toHaveBeenCalledWith("e1", expect.any(Number))
    })

    it("does not start a second flush while one is already running", async () => {
      let resolveSend!: (value: Result<PushAck[], SyncError>) => void
      client.sendEvents.mockReturnValue(
        new Promise((resolve) => {
          resolveSend = resolve
        })
      )
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )

      const first = engine.flush()
      const second = engine.flush()

      resolveSend(Result.ok([]))
      await Promise.all([first, second])

      expect(client.sendEvents).toHaveBeenCalledTimes(1)
    })

    it("drains multiple pages in one call via the outbox's keyset cursor", async () => {
      const engineWithSmallBatch = new SyncEngine(
        outbox,
        events,
        client,
        cursor,
        applier,
        listSyncState,
        1
      )
      outbox.getPending
        .mockResolvedValueOnce(Result.ok([makeOutboxRow("e1")]))
        .mockResolvedValueOnce(Result.ok([makeOutboxRow("e2")]))
        .mockResolvedValueOnce(Result.ok([]))
      events.getByEventIds.mockImplementation(async (ids: string[]) =>
        Result.ok(ids.map((id) => makeEvent({ event_id: id })))
      )

      await engineWithSmallBatch.flush()

      expect(outbox.getPending).toHaveBeenCalledTimes(3)
      expect(outbox.getPending).toHaveBeenNthCalledWith(1, 1, undefined)
      expect(outbox.getPending).toHaveBeenNthCalledWith(2, 1, "e1")
      expect(outbox.getPending).toHaveBeenNthCalledWith(3, 1, "e2")
      expect(client.sendEvents).toHaveBeenCalledTimes(2)
      expect(client.sendEvents).toHaveBeenNthCalledWith(1, [
        makeEvent({ event_id: "e1" }),
      ])
      expect(client.sendEvents).toHaveBeenNthCalledWith(2, [
        makeEvent({ event_id: "e2" }),
      ])
    })

    it("stops after MAX_DRAIN_BATCHES pages even if more remain pending", async () => {
      const engineWithSmallBatch = new SyncEngine(
        outbox,
        events,
        client,
        cursor,
        applier,
        listSyncState,
        1
      )
      // Every page is exactly at the batch limit, so the "short page"
      // termination heuristic never fires - only the hard cap should stop
      // this from looping forever against an ever-growing backlog.
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )

      await engineWithSmallBatch.flush()

      expect(outbox.getPending).toHaveBeenCalledTimes(MAX_DRAIN_BATCHES)
      expect(client.sendEvents).toHaveBeenCalledTimes(MAX_DRAIN_BATCHES)
    })

    it('does not falsely mark a list "error" whose only batch already succeeded, just because the rest of a long flush() is still going', async () => {
      jest.useFakeTimers()
      try {
        const engineWithSmallBatch = new SyncEngine(
          outbox,
          events,
          client,
          cursor,
          applier,
          listSyncState,
          1
        )
        // list-A appears (and succeeds) in the very first batch only; every
        // batch after that belongs to list-B, and list-A never comes back.
        // Each batch "takes" 5s - under list-A's own stale-guard budget for
        // a single batch, but the 19 list-B batches after it total well
        // past it. Only touching every already-open list pass on every
        // batch (not just the ones whose own group shows up in it) can
        // keep list-A's pass, whose actual push already succeeded, from
        // being falsely declared stale while the rest of the drain runs.
        const listIdByEvent = new Map<string, string>()
        let batchCount = 0
        outbox.getPending.mockImplementation(async () => {
          jest.advanceTimersByTime(5_000)
          const eventId = `e${batchCount}`
          const listId = batchCount === 0 ? "list-A" : "list-B"
          listIdByEvent.set(eventId, listId)
          batchCount++
          return Result.ok([makeOutboxRow(eventId)])
        })
        events.getByEventIds.mockImplementation(async (ids: string[]) =>
          Result.ok(
            ids.map((id) =>
              makeEvent({ event_id: id, list_id: listIdByEvent.get(id)! })
            )
          )
        )
        client.sendEvents.mockImplementation(async (sent) =>
          Result.ok(sent.map((event) => ({ eventId: event.event_id, seq: 1 })))
        )

        await engineWithSmallBatch.flush()

        expect(outbox.getPending).toHaveBeenCalledTimes(MAX_DRAIN_BATCHES)
        expect(getListSyncStatus("list-A")).toBe("synced")
      } finally {
        jest.useRealTimers()
      }
    })

    it("keeps draining subsequent pages after a send fails, rather than stopping the whole flush", async () => {
      // A dead batch/list must not block everything queued behind it - see
      // the PR #249 review on the original all-or-nothing flush().
      const engineWithSmallBatch = new SyncEngine(
        outbox,
        events,
        client,
        cursor,
        applier,
        listSyncState,
        1
      )
      outbox.getPending
        .mockResolvedValueOnce(Result.ok([makeOutboxRow("e1")]))
        .mockResolvedValueOnce(Result.ok([makeOutboxRow("e2")]))
      events.getByEventIds.mockImplementation(async (ids: string[]) =>
        Result.ok(ids.map((id) => makeEvent({ event_id: id })))
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await engineWithSmallBatch.flush()

      expect(client.sendEvents).toHaveBeenCalledTimes(2)
      // A 3rd call comes back empty (the base mock's default) - that's what
      // actually stops the drain, not the earlier failures.
      expect(outbox.getPending).toHaveBeenCalledTimes(3)
    })

    it("sends each list's events as its own request, so one list's rejection can't fail another list's events in the same page", async () => {
      outbox.getPending.mockResolvedValue(
        Result.ok([makeOutboxRow("e1"), makeOutboxRow("e2")])
      )
      events.getByEventIds.mockResolvedValue(
        Result.ok([
          makeEvent({ event_id: "e1", list_id: "list-1" }),
          makeEvent({ event_id: "e2", list_id: "list-2" }),
        ])
      )
      client.sendEvents.mockImplementation(async (evts) =>
        evts[0].list_id === "list-1"
          ? Result.fail(new SyncError("Forbidden", false))
          : Result.ok([{ eventId: "e2", seq: 1 }])
      )

      await engine.flush()

      expect(client.sendEvents).toHaveBeenCalledTimes(2)
      expect(client.sendEvents).toHaveBeenCalledWith([
        expect.objectContaining({ event_id: "e1", list_id: "list-1" }),
      ])
      expect(client.sendEvents).toHaveBeenCalledWith([
        expect.objectContaining({ event_id: "e2", list_id: "list-2" }),
      ])
      expect(getListSyncStatus("list-1")).toBe("error")
      expect(getListSyncStatus("list-2")).toBe("synced")
      // list-2's send succeeded even though list-1's failed non-retryably.
      expect(outbox.bumpAttempt).toHaveBeenCalledWith("e2", expect.any(Number))
    })

    it("disables sync and drops the remaining outbox backlog for a list that's permanently rejected (e.g. 403 - no longer a member)", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", list_id: "list-1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("Forbidden", false))
      )

      await engine.flush()

      expect(listSyncState.setEnabled).toHaveBeenCalledWith("list-1", false)
      expect(outbox.cancelForList).toHaveBeenCalledWith("list-1")
    })

    it("records permission denial for a rejected upload and clears it after an authorized upload", async () => {
      outbox.getPending.mockResolvedValue(
        Result.ok([makeOutboxRow("permission-event")])
      )
      events.getByEventIds.mockResolvedValue(
        Result.ok([
          makeEvent({
            event_id: "permission-event",
            list_id: "permission-list",
          }),
        ])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("Forbidden", false, undefined, 403))
      )
      await engine.flush()
      expect(getListSyncStatus("permission-list")).toBe("forbidden")
      expect(listSyncState.setEnabled).toHaveBeenCalledWith(
        "permission-list",
        false
      )
      client.sendEvents.mockResolvedValue(
        Result.ok([{ eventId: "permission-event", seq: 1 }])
      )
      await engine.flush()
      expect(getListSyncStatus("permission-list")).toBe("synced")
    })

    it("isolates a forbidden list in a rejected heads batch", async () => {
      client.getListHeads.mockImplementation(async (ids) =>
        ids.includes("denied-head")
          ? Result.fail(new SyncError("Forbidden", false, undefined, 403))
          : Result.ok(ids.map((listId) => ({ listId, seq: 0, eventId: null })))
      )
      await engine.pull(["denied-head", "allowed-head"])
      expect(getListSyncStatus("denied-head")).toBe("forbidden")
      expect(getListSyncStatus("allowed-head")).toBe("synced")
      expect(listSyncState.setEnabled).toHaveBeenCalledWith(
        "denied-head",
        false
      )
      expect(listSyncState.setEnabled).not.toHaveBeenCalledWith(
        "allowed-head",
        false
      )
    })

    it("records permission denial when access is lost while downloading events", async () => {
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "denied-page", seq: 1, eventId: "remote" }])
      )
      client.getEventsSince.mockResolvedValue(
        Result.fail(new SyncError("Forbidden", false, undefined, 403))
      )
      await engine.pull(["denied-page"])
      expect(getListSyncStatus("denied-page")).toBe("forbidden")
      expect(outbox.cancelForList).toHaveBeenCalledWith("denied-page")
      expect(applier.apply).not.toHaveBeenCalled()
    })

    it("does not touch list_sync_state for a retryable failure", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", list_id: "list-1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await engine.flush()

      expect(listSyncState.setEnabled).not.toHaveBeenCalled()
      expect(outbox.cancelForList).not.toHaveBeenCalled()
    })

    it("drops the specific rows (rather than disabling a list) when a permanently rejected event has no list_id", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", list_id: null })])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("Bad request", false))
      )

      await engine.flush()

      expect(outbox.cancelEventIds).toHaveBeenCalledWith(["e1"])
      expect(listSyncState.setEnabled).not.toHaveBeenCalled()
    })

    it("excludes rows already in flight from a concurrent call", async () => {
      let resolveSend!: (value: Result<PushAck[], SyncError>) => void
      client.sendEvents.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve
          })
      )
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )

      const first = engine.flush()
      // Let the first flush grab e1 and start "sending" before resolving.
      await flushMicrotasks()

      resolveSend(Result.ok([]))
      await first
      expect(client.sendEvents).toHaveBeenCalledTimes(1)
    })

    it('does not falsely mark a list "error" while sendGroup\'s per-event bumpAttempt loop runs long', async () => {
      jest.useFakeTimers()
      try {
        const rows = [
          makeOutboxRow("e1"),
          makeOutboxRow("e2"),
          makeOutboxRow("e3"),
        ]
        outbox.getPending.mockResolvedValue(Result.ok(rows))
        events.getByEventIds.mockResolvedValue(
          Result.ok(rows.map((row) => makeEvent({ event_id: row.event_id })))
        )
        client.sendEvents.mockResolvedValue(
          Result.ok(rows.map((row, i) => ({ eventId: row.event_id, seq: i })))
        )
        // Each write alone is comfortably under the stale budget, but the
        // three together aren't - only possible without a false "error"
        // because bumpAttempt's own loop touches after every write, not
        // just once when the whole group is done.
        outbox.bumpAttempt.mockImplementation(async () => {
          jest.advanceTimersByTime(12_000)
          return Result.ok(undefined)
        })

        await engine.flush()

        expect(getListSyncStatus("list-1")).toBe("synced")
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe("push confirmations", () => {
    beforeEach(() => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.ok([{ eventId: "e1", seq: 1 }])
      )
    })

    it("logs but does not throw when marking synced fails", async () => {
      outbox.markSynced.mockResolvedValue(
        Result.fail(new DbQueryError("boom", "markSynced", "EventOutbox"))
      )

      await expect(engine.flush()).resolves.toBe(false)
    })

    // seq has exactly one writer - the pull path (EventRepository.insertRemote)
    // - so a confirmation never touches domain_events or triggers a rebuild.
    // It carries the assigned seq, but only the pull writes it; that's what
    // keeps confirmations out of replay ordering entirely (see #227,
    // "serialize ack processing to preserve seq order" - there is nothing
    // left for a second, out-of-band writer to race).
    it("never rebuilds anything, however many events it confirms", async () => {
      await engine.flush()

      expect(applier.apply).not.toHaveBeenCalled()
    })
  })

  describe("reconcile", () => {
    it("does nothing for an empty list id list", async () => {
      await engine.reconcile([])

      expect(client.getKnownEventIds).not.toHaveBeenCalled()
    })

    it("re-enqueues and resets to pending anything the server doesn't know about", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["known-evt"]))
      events.getByListId.mockResolvedValue(
        Result.ok([
          makeEvent({
            event_id: "known-evt",
            event_type: EventTypes.TODO_LIST_CREATED,
            seq: 1,
          }),
          makeEvent({
            event_id: "missing-evt",
            event_type: EventTypes.TODO_LIST_UPDATED,
          }),
        ])
      )

      await engine.reconcile(["list-1"])

      expect(client.getKnownEventIds).toHaveBeenCalledWith(["list-1"])
      expect(events.getByListId).toHaveBeenCalledWith("list-1")
      expect(events.enqueueExistingForSync).toHaveBeenCalledWith([
        expect.objectContaining({ event_id: "missing-evt" }),
      ])
      expect(outbox.resetToPending).toHaveBeenCalledWith(["missing-evt"])
      // Self-heal should flush right away rather than waiting for the next
      // unrelated trigger.
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("chunks more than 200 list ids into separate getKnownEventIds calls, then flushes once", async () => {
      const listIds = Array.from({ length: 250 }, (_, i) => `list-${i}`)

      await engine.reconcile(listIds)

      expect(client.getKnownEventIds).toHaveBeenCalledTimes(2)
      expect(client.getKnownEventIds).toHaveBeenNthCalledWith(
        1,
        listIds.slice(0, 200)
      )
      expect(client.getKnownEventIds).toHaveBeenNthCalledWith(
        2,
        listIds.slice(200)
      )
      expect(outbox.getPending).toHaveBeenCalledTimes(1)
    })

    it("isolates a forbidden list in a rejected getKnownEventIds batch, without misreporting the whole batch as failed", async () => {
      client.getKnownEventIds.mockImplementation(async (ids) =>
        ids.includes("denied-known")
          ? Result.fail(new SyncError("Forbidden", false, undefined, 403))
          : Result.ok([])
      )
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})

      await engine.reconcile(["denied-known", "allowed-known"])

      expect(getListSyncStatus("denied-known")).toBe("forbidden")
      expect(listSyncState.setEnabled).toHaveBeenCalledWith(
        "denied-known",
        false
      )
      // The other list in the batch isolates cleanly and actually
      // reconciles - the batch is a partial success, not a failure.
      expect(client.getKnownEventIds).toHaveBeenCalledWith(["allowed-known"])
      expect(
        warnSpy.mock.calls.some(([message]) =>
          String(message).includes("Reconcile failed")
        )
      ).toBe(false)

      warnSpy.mockRestore()
    })

    it("ignores non-syncable (local-only) event types when comparing against the server", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok([]))
      events.getByListId.mockResolvedValue(
        Result.ok([
          // Every real EventTypes value is syncable today (todo_list.* and
          // ingredient.*) - this synthetic type exercises the
          // SYNCABLE_EVENT_TYPES filter itself, standing in for whatever
          // future local-only event type might exist.
          makeEvent({
            event_id: "local-only",
            event_type: "something.local_only",
          }),
        ])
      )

      await engine.reconcile(["list-1"])

      expect(events.enqueueExistingForSync).not.toHaveBeenCalled()
      expect(outbox.resetToPending).not.toHaveBeenCalled()
    })

    it("does nothing further when the server already knows everything and locally has a seq", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["e1"]))
      events.getByListId.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", seq: 1 })])
      )

      await engine.reconcile(["list-1"])

      expect(events.enqueueExistingForSync).not.toHaveBeenCalled()
      expect(outbox.resetToPending).not.toHaveBeenCalled()
      expect(cursor.clear).not.toHaveBeenCalled()
    })

    it("repairs a list when the server knows an event we still show as locally unconfirmed, and we've caught up to the server head", async () => {
      // seq has exactly one writer, the pull path - so server-knows +
      // local seq === null means our ordering has drifted, not that the
      // event is merely unsent (see sync-design-decisions.md). That's only
      // true once our cursor has reached the server's head - otherwise a
      // just-acked, not-yet-pulled event looks identical.
      client.getKnownEventIds.mockResolvedValue(Result.ok(["e1"]))
      events.getByListId.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", seq: null })])
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e1" }])
      )
      cursor.get.mockResolvedValue(
        Result.ok({ list_id: "list-1", last_seen_seq: 5, last_pulled_at: null })
      )
      client.getEventsSince.mockResolvedValue(
        Result.ok({ events: [], nextSeq: 5, hasMore: false })
      )

      await engine.reconcile(["list-1"])

      expect(cursor.clear).toHaveBeenCalledWith("list-1")
      // repairList's pull re-derives from scratch via the normal pull path.
      expect(client.getListHeads).toHaveBeenCalledWith(["list-1"])
    })

    it("does not repair a freshly-acked, not-yet-pulled event - only a drift signal once caught up to the server head", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["e1"]))
      events.getByListId.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", seq: null })])
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e1" }])
      )
      // Cursor is behind the head - a pull just hasn't caught up yet.
      cursor.get.mockResolvedValue(
        Result.ok({ list_id: "list-1", last_seen_seq: 2, last_pulled_at: null })
      )

      await engine.reconcile(["list-1"])

      expect(cursor.clear).not.toHaveBeenCalled()
    })

    it("does not repair when list heads can't be fetched, but still re-enqueues missing events", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["known-evt"]))
      client.getListHeads.mockResolvedValue(
        Result.fail(new SyncError("boom", true))
      )
      events.getByListId.mockResolvedValue(
        Result.ok([
          makeEvent({ event_id: "known-evt", seq: null }),
          makeEvent({ event_id: "missing-evt" }),
        ])
      )

      await engine.reconcile(["list-1"])

      expect(cursor.clear).not.toHaveBeenCalled()
      expect(events.enqueueExistingForSync).toHaveBeenCalledWith([
        expect.objectContaining({ event_id: "missing-evt" }),
      ])
    })

    it("does not repair a list that's merely missing from the server (handled by re-enqueue instead)", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok([]))
      events.getByListId.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1", seq: null })])
      )

      await engine.reconcile(["list-1"])

      expect(cursor.clear).not.toHaveBeenCalled()
      expect(events.enqueueExistingForSync).toHaveBeenCalled()
    })

    it('does not falsely mark a list "error" from reconcile\'s own pass while the repair it triggered runs a slow multi-page pull', async () => {
      jest.useFakeTimers()
      try {
        client.getKnownEventIds.mockResolvedValue(Result.ok(["e1"]))
        events.getByListId.mockResolvedValue(
          Result.ok([makeEvent({ event_id: "e1", seq: null })])
        )
        client.getListHeads.mockResolvedValue(
          Result.ok([{ listId: "list-1", seq: 5, eventId: "e1" }])
        )
        // Caught up to the head on the first read (before repair clears the
        // cursor), then back to 0 on every read after (what a real clear()
        // would produce).
        cursor.get
          .mockResolvedValueOnce(
            Result.ok({
              list_id: "list-1",
              last_seen_seq: 5,
              last_pulled_at: null,
            })
          )
          .mockResolvedValue(
            Result.ok({
              list_id: "list-1",
              last_seen_seq: 0,
              last_pulled_at: null,
            })
          )
        // Five slow pages - comfortably past reconcile's own stale budget in
        // total, even though reconcile's pass never touches itself. Only the
        // nested pull's own per-page touches (shared scope, see
        // stale-pass-guard.ts) can keep it alive.
        client.getEventsSince.mockImplementation(async (_listId, since) => {
          jest.advanceTimersByTime(25_000)
          const nextSeq = (since as number) + 1
          return Result.ok({ events: [], nextSeq, hasMore: nextSeq < 5 })
        })

        await engine.reconcile(["list-1"])

        expect(cursor.clear).toHaveBeenCalledWith("list-1")
        expect(getListSyncStatus("list-1")).toBe("synced")
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe("repairList", () => {
    it("clears the pull cursor and re-pulls the list from scratch", async () => {
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e1" }])
      )
      client.getEventsSince.mockResolvedValue(
        Result.ok({ events: [], nextSeq: 5, hasMore: false })
      )

      await engine.repairList("list-1")

      expect(cursor.clear).toHaveBeenCalledWith("list-1")
      expect(client.getListHeads).toHaveBeenCalledWith(["list-1"])
    })

    it("does not attempt a pull when clearing the cursor fails", async () => {
      cursor.clear.mockResolvedValue(
        Result.fail(new DbQueryError("boom", "clear", "SyncCursor"))
      )

      await engine.repairList("list-1")

      expect(client.getListHeads).not.toHaveBeenCalled()
    })
  })

  describe("pull", () => {
    it("does nothing for an empty list id list", async () => {
      await engine.pull([])

      expect(client.getListHeads).not.toHaveBeenCalled()
    })

    it("(a) pulls missing events when the server head is ahead of the local cursor, then flushes", async () => {
      cursor.get.mockResolvedValue(
        Result.ok({ list_id: "list-1", last_seen_seq: 0, last_pulled_at: null })
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e5" }])
      )
      client.getEventsSince.mockResolvedValue(
        Result.ok({
          events: [makeEvent({ event_id: "e1" })],
          nextSeq: 5,
          hasMore: false,
        })
      )

      await engine.pull(["list-1"])

      expect(client.getEventsSince).toHaveBeenCalledWith(
        "list-1",
        0,
        expect.any(Number)
      )
      expect(applier.apply).toHaveBeenCalledWith(
        "list-1",
        [makeEvent({ event_id: "e1" })],
        5
      )
      // Pull always ends with a flush - local state should reflect remote
      // before anything new goes out, but pending pushes still go out.
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("(a) loops pulling pages until has_more is false", async () => {
      cursor.get.mockResolvedValue(Result.ok(null))
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 10, eventId: "e10" }])
      )
      client.getEventsSince
        .mockResolvedValueOnce(
          Result.ok({
            events: [makeEvent({ event_id: "e1" })],
            nextSeq: 5,
            hasMore: true,
          })
        )
        .mockResolvedValueOnce(
          Result.ok({
            events: [makeEvent({ event_id: "e2" })],
            nextSeq: 10,
            hasMore: false,
          })
        )

      await engine.pull(["list-1"])

      expect(client.getEventsSince).toHaveBeenNthCalledWith(
        1,
        "list-1",
        0,
        expect.any(Number)
      )
      expect(client.getEventsSince).toHaveBeenNthCalledWith(
        2,
        "list-1",
        5,
        expect.any(Number)
      )
      expect(applier.apply).toHaveBeenCalledTimes(2)
    })

    it("stops after MAX_PULL_PAGES pages even if more remain, without marking the list an error", async () => {
      // Every page reports hasMore: true, so the "no more pages"
      // termination heuristic never fires - only the hard cap should stop
      // this from looping forever against a huge backlog.
      cursor.get.mockResolvedValue(Result.ok(null))
      client.getListHeads.mockResolvedValue(
        Result.ok([
          { listId: "list-1", seq: Number.MAX_SAFE_INTEGER, eventId: "e" },
        ])
      )
      client.getEventsSince.mockImplementation(async (_listId, since) =>
        Result.ok({
          events: [makeEvent({ event_id: `e${since}` })],
          nextSeq: since + 1,
          hasMore: true,
        })
      )

      await engine.pull(["list-1"])

      expect(client.getEventsSince).toHaveBeenCalledTimes(MAX_PULL_PAGES)
      expect(applier.apply).toHaveBeenCalledTimes(MAX_PULL_PAGES)
      // Capped early is not a failure - the next trigger resumes from the
      // durably-persisted cursor, same as flush()'s MAX_DRAIN_BATCHES.
      expect(getListSyncStatus("list-1")).toBe("synced")
    })

    it('never lets the aggregate sync status go "error" through a slow multi-page pull of a single list', async () => {
      jest.useFakeTimers()
      try {
        cursor.get.mockResolvedValue(Result.ok(null))
        client.getListHeads.mockResolvedValue(
          Result.ok([{ listId: "list-1", seq: 5, eventId: "e" }])
        )
        // Each page "takes" 25s (under the per-request stale-guard budget)
        // but resolving 5 of them totals well past it - only per-page
        // touch(), not just the once-per-list touch after pullListToHead
        // returns, can keep the aggregate watchdog from firing mid-pull.
        client.getEventsSince.mockImplementation(async (_listId, since) => {
          jest.advanceTimersByTime(25_000)
          return Result.ok({
            events: [makeEvent({ event_id: `e${since}` })],
            nextSeq: since + 1,
            hasMore: since < 4,
          })
        })
        // pull() always flushes afterwards, and a quick successful flush
        // would mask a transient "error" set mid-pull by re-arming a fresh
        // pass - record every status the aggregate ever took on instead of
        // just the final one.
        const statusesSeen: string[] = []
        const unsubscribe = onSyncStatusChanged(() =>
          statusesSeen.push(getSyncStatus())
        )

        await engine.pull(["list-1"])
        unsubscribe()

        expect(client.getEventsSince).toHaveBeenCalledTimes(5)
        expect(statusesSeen).not.toContain("error")
      } finally {
        jest.useRealTimers()
      }
    })

    it("(b)/(c) skips pulling when already caught up, but still flushes", async () => {
      cursor.get.mockResolvedValue(
        Result.ok({ list_id: "list-1", last_seen_seq: 5, last_pulled_at: null })
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e5" }])
      )

      await engine.pull(["list-1"])

      expect(client.getEventsSince).not.toHaveBeenCalled()
      expect(applier.apply).not.toHaveBeenCalled()
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("clamps the cursor down when the server head is behind it (server lost data)", async () => {
      cursor.get.mockResolvedValue(
        Result.ok({
          list_id: "list-1",
          last_seen_seq: 10,
          last_pulled_at: null,
        })
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 3, eventId: "e3" }])
      )

      await engine.pull(["list-1"])

      expect(cursor.set).toHaveBeenCalledWith("list-1", 3, expect.any(Number))
      expect(client.getEventsSince).not.toHaveBeenCalled()
    })

    it("skips a list (but still flushes), without treating it as an empty cursor, when reading the local cursor fails", async () => {
      cursor.get.mockResolvedValue(
        Result.fail(
          new DbQueryError("disk full", "get", "SyncCursorRepository")
        )
      )
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e5" }])
      )

      await engine.pull(["list-1"])

      // A real read failure must not be treated as "never pulled" (seq 0),
      // which would force an unnecessary full pull or a false clamp.
      expect(client.getEventsSince).not.toHaveBeenCalled()
      expect(cursor.set).not.toHaveBeenCalled()
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("skips a list id the server's head response omitted, without crashing", async () => {
      client.getListHeads.mockResolvedValue(Result.ok([]))

      await expect(engine.pull(["list-1"])).resolves.toBe(true)

      expect(client.getEventsSince).not.toHaveBeenCalled()
      // Still flushes - a head lookup gap for one list must not block
      // pushing whatever else is pending.
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("keeps download failures specific to their list and recovers on retry", async () => {
      client.getListHeads.mockResolvedValue(
        Result.ok([
          { listId: "pull-bad", seq: 1, eventId: "a" },
          { listId: "pull-good", seq: 0, eventId: "b" },
        ])
      )
      client.getEventsSince.mockResolvedValue(
        Result.fail(new SyncError("failed", true))
      )
      await engine.pull(["pull-bad", "pull-good"])
      expect(getListSyncStatus("pull-bad")).toBe("error")
      expect(getListSyncStatus("pull-good")).toBe("synced")
      client.getEventsSince.mockResolvedValue(
        Result.ok({ events: [], nextSeq: 1, hasMore: false })
      )
      await engine.pull(["pull-bad"])
      expect(getListSyncStatus("pull-bad")).toBe("synced")
    })

    it("stops pulling a list (but still flushes) when fetching a page fails", async () => {
      cursor.get.mockResolvedValue(Result.ok(null))
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e5" }])
      )
      client.getEventsSince.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await engine.pull(["list-1"])

      expect(applier.apply).not.toHaveBeenCalled()
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("stops pulling a list (but still flushes) when applying a page fails", async () => {
      cursor.get.mockResolvedValue(Result.ok(null))
      client.getListHeads.mockResolvedValue(
        Result.ok([{ listId: "list-1", seq: 5, eventId: "e5" }])
      )
      client.getEventsSince.mockResolvedValue(
        Result.ok({ events: [makeEvent()], nextSeq: 5, hasMore: false })
      )
      applier.apply.mockResolvedValue(
        Result.fail(new DbQueryError("boom", "apply", "EventApplier"))
      )

      await engine.pull(["list-1"])

      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("does not flush when fetching heads itself fails", async () => {
      client.getListHeads.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await engine.pull(["list-1"])

      expect(outbox.getPending).not.toHaveBeenCalled()
    })
  })

  describe("pullList", () => {
    it("delegates to pull with a single-element list id array", async () => {
      client.getListHeads.mockResolvedValue(Result.ok([]))

      await engine.pullList("list-1")

      expect(client.getListHeads).toHaveBeenCalledWith(["list-1"])
    })
  })
})
