import { SyncEngine, MAX_DRAIN_BATCHES } from "../sync-engine"
import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { SyncClient } from "@/api/sync/sync-client"
import { Result } from "@/api/common/result"
import { SyncError } from "@/api/common/error-types"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"

jest.mock("@/database/outbox-repository")
jest.mock("@/database/event-repository")
jest.mock("@/api/sync/sync-client")

const MockOutboxRepository = OutboxRepository as jest.MockedClass<
  typeof OutboxRepository
>
const MockEventRepository = EventRepository as jest.MockedClass<
  typeof EventRepository
>
const MockSyncClient = SyncClient as jest.MockedClass<typeof SyncClient>

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
  let client: jest.Mocked<SyncClient>
  let engine: SyncEngine

  beforeEach(() => {
    jest.clearAllMocks()

    outbox = {
      getPending: jest.fn().mockResolvedValue(Result.ok([])),
      markSynced: jest.fn().mockResolvedValue(Result.ok(undefined)),
      bumpAttempt: jest.fn().mockResolvedValue(Result.ok(undefined)),
      resetToPending: jest.fn().mockResolvedValue(Result.ok(undefined)),
      cancelForList: jest.fn(),
      enqueue: jest.fn(),
    } as unknown as jest.Mocked<OutboxRepository>

    events = {
      getByEventIds: jest.fn().mockResolvedValue(Result.ok([])),
      getByAggregateId: jest.fn().mockResolvedValue(Result.ok([])),
      enqueueExistingForSync: jest.fn().mockResolvedValue(Result.ok(undefined)),
    } as unknown as jest.Mocked<EventRepository>

    client = {
      sendEvents: jest.fn().mockResolvedValue(Result.ok(undefined)),
      getKnownEventIds: jest.fn().mockResolvedValue(Result.ok([])),
    } as unknown as jest.Mocked<SyncClient>

    MockOutboxRepository.mockImplementation(() => outbox)
    MockEventRepository.mockImplementation(() => events)
    MockSyncClient.mockImplementation(() => client)

    engine = new SyncEngine(outbox, events, client)
  })

  describe("flush", () => {
    it("does nothing when there are no pending rows", async () => {
      await engine.flush()

      expect(events.getByEventIds).not.toHaveBeenCalled()
      expect(client.sendEvents).not.toHaveBeenCalled()
    })

    it("sends pending events and bumps their attempt count, without marking them synced", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )

      await engine.flush()

      expect(client.sendEvents).toHaveBeenCalledWith([
        makeEvent({ event_id: "e1" }),
      ])
      expect(outbox.bumpAttempt).toHaveBeenCalledWith("e1", expect.any(Number))
      // A 202 is not a commit confirmation - flush must never call
      // markSynced on its own.
      expect(outbox.markSynced).not.toHaveBeenCalled()
    })

    it("still bumps attempts when the send fails, but does not throw", async () => {
      outbox.getPending.mockResolvedValue(Result.ok([makeOutboxRow("e1")]))
      events.getByEventIds.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )
      client.sendEvents.mockResolvedValue(
        Result.fail(new SyncError("network down", true))
      )

      await expect(engine.flush()).resolves.toBeUndefined()
      expect(outbox.bumpAttempt).toHaveBeenCalledWith("e1", expect.any(Number))
    })

    it("does not start a second flush while one is already running", async () => {
      let resolveSend!: (value: Result<void, SyncError>) => void
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

      resolveSend(Result.ok(undefined))
      await Promise.all([first, second])

      expect(client.sendEvents).toHaveBeenCalledTimes(1)
    })

    it("drains multiple pages in one call via the outbox's keyset cursor", async () => {
      const engineWithSmallBatch = new SyncEngine(outbox, events, client, 1)
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
      const engineWithSmallBatch = new SyncEngine(outbox, events, client, 1)
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

    it("stops draining (without querying further pages) once a send fails", async () => {
      const engineWithSmallBatch = new SyncEngine(outbox, events, client, 1)
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

      expect(client.sendEvents).toHaveBeenCalledTimes(1)
      expect(outbox.getPending).toHaveBeenCalledTimes(1)
    })

    it("excludes rows already in flight from a concurrent call", async () => {
      let resolveSend!: (value: Result<void, SyncError>) => void
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
      await Promise.resolve()
      await Promise.resolve()

      resolveSend(Result.ok(undefined))
      await first
      expect(client.sendEvents).toHaveBeenCalledTimes(1)
    })
  })

  describe("handleAck", () => {
    it("marks the acked event as synced", async () => {
      await engine.handleAck("e1")

      expect(outbox.markSynced).toHaveBeenCalledWith("e1")
    })
  })

  describe("reconcile", () => {
    it("does nothing for an empty aggregate id list", async () => {
      await engine.reconcile([])

      expect(client.getKnownEventIds).not.toHaveBeenCalled()
    })

    it("re-enqueues and resets to pending anything the server doesn't know about", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["known-evt"]))
      events.getByAggregateId.mockResolvedValue(
        Result.ok([
          makeEvent({
            event_id: "known-evt",
            event_type: EventTypes.TODO_LIST_CREATED,
          }),
          makeEvent({
            event_id: "missing-evt",
            event_type: EventTypes.TODO_LIST_UPDATED,
          }),
        ])
      )

      await engine.reconcile(["list-1"])

      expect(client.getKnownEventIds).toHaveBeenCalledWith(["list-1"])
      expect(events.enqueueExistingForSync).toHaveBeenCalledWith([
        expect.objectContaining({ event_id: "missing-evt" }),
      ])
      expect(outbox.resetToPending).toHaveBeenCalledWith(["missing-evt"])
      // Self-heal should flush right away rather than waiting for the next
      // unrelated trigger.
      expect(outbox.getPending).toHaveBeenCalled()
    })

    it("ignores non-syncable (local-only) event types when comparing against the server", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok([]))
      events.getByAggregateId.mockResolvedValue(
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

    it("does nothing further when the server already knows everything", async () => {
      client.getKnownEventIds.mockResolvedValue(Result.ok(["e1"]))
      events.getByAggregateId.mockResolvedValue(
        Result.ok([makeEvent({ event_id: "e1" })])
      )

      await engine.reconcile(["list-1"])

      expect(events.enqueueExistingForSync).not.toHaveBeenCalled()
      expect(outbox.resetToPending).not.toHaveBeenCalled()
    })
  })
})
