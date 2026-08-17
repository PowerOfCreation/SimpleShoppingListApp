import { SyncClient } from "../sync-client"
import { Result } from "@/api/common/result"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"

import { getValidAccessToken } from "@/api/auth/auth-service"

jest.mock("@/api/auth/auth-service", () => ({
  getValidAccessToken: jest.fn(),
}))
const mockGetValidAccessToken = getValidAccessToken as jest.Mock

const makeEvent = (
  overrides: Partial<DomainEventRow> = {}
): DomainEventRow => ({
  event_id: "evt-1",
  event_type: EventTypes.TODO_LIST_CREATED,
  aggregate_id: "list-1",
  aggregate_type: "todo_list",
  list_id: "list-1",
  occurred_at: 1234,
  client_id: "client-1",
  payload: JSON.stringify({ name: "Rewe" }),
  seq: null,
  ...overrides,
})

describe("SyncClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetValidAccessToken.mockResolvedValue(Result.ok("valid-token"))
  })

  describe("sendEvents", () => {
    it("sends events with the payload as a JSON value, not a stringified string", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 })
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/events")
      expect(options.headers.Authorization).toBe("Bearer valid-token")

      const body = JSON.parse(options.body)
      expect(body).toEqual([
        {
          event_id: "evt-1",
          event_type: EventTypes.TODO_LIST_CREATED,
          aggregate_id: "list-1",
          aggregate_type: "todo_list",
          list_id: "list-1",
          occurred_at: 1234,
          client_id: "client-1",
          payload: { name: "Rewe" }, // parsed, not the raw string
        },
      ])
    })

    it("does nothing and succeeds trivially for an empty batch", async () => {
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([])

      expect(result.success).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a 401 as non-retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 })
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
    })

    it("treats a 403 as non-retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403 })
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
    })

    it("treats a 5xx response as retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503 })
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
    })

    it("treats a network/timeout error as retryable", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error("network down"))
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
    })

    it("treats a missing/unrefreshable token as retryable (try again later)", async () => {
      mockGetValidAccessToken.mockResolvedValue(
        Result.fail(new Error("refresh failed"))
      )
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats being signed out as non-retryable", async () => {
      mockGetValidAccessToken.mockResolvedValue(Result.ok(null))
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.sendEvents([makeEvent()])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("getKnownEventIds", () => {
    it("posts list ids and returns known event ids", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ known_event_ids: ["evt-1", "evt-2"] }),
      })
      const client = new SyncClient(fetchMock)

      const result = await client.getKnownEventIds(["list-1", "list-2"])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual(["evt-1", "evt-2"])

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/sync/state")
      expect(JSON.parse(options.body)).toEqual({
        list_ids: ["list-1", "list-2"],
      })
    })

    it("returns an empty list trivially for no list ids", async () => {
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getKnownEventIds([])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a missing/unrefreshable token as retryable, without fetching", async () => {
      mockGetValidAccessToken.mockResolvedValue(
        Result.fail(new Error("refresh failed"))
      )
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getKnownEventIds(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a 403 as non-retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403 })
      const client = new SyncClient(fetchMock)

      const result = await client.getKnownEventIds(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
    })
  })

  describe("getListHeads", () => {
    it("posts list ids and returns each head, snake_case mapped to camelCase", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          heads: [
            { list_id: "list-1", seq: 42, event_id: "evt-9" },
            { list_id: "list-2", seq: 0, event_id: null },
          ],
        }),
      })
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads(["list-1", "list-2"])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([
        { listId: "list-1", seq: 42, eventId: "evt-9" },
        { listId: "list-2", seq: 0, eventId: null },
      ])

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/sync/head")
      expect(options.headers.Authorization).toBe("Bearer valid-token")
      expect(JSON.parse(options.body)).toEqual({
        list_ids: ["list-1", "list-2"],
      })
    })

    it("returns an empty list trivially for no list ids, without fetching", async () => {
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads([])

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a non-ok response as retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 })
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
    })

    it("treats a 403 as non-retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403 })
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
    })

    it("treats being signed out as non-retryable, without fetching", async () => {
      mockGetValidAccessToken.mockResolvedValue(Result.ok(null))
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a missing/unrefreshable token as retryable, without fetching", async () => {
      mockGetValidAccessToken.mockResolvedValue(
        Result.fail(new Error("refresh failed"))
      )
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getListHeads(["list-1"])

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("getEventsSince", () => {
    it("requests the given list/since_seq/limit and parses the page back into DomainEventRows", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          list_id: "list-1",
          events: [
            {
              event_id: "evt-1",
              event_type: EventTypes.TODO_LIST_CREATED,
              aggregate_id: "list-1",
              aggregate_type: "todo_list",
              list_id: "list-1",
              occurred_at: 1234,
              client_id: "client-1",
              payload: { name: "Rewe" },
              seq: 7,
            },
          ],
          next_seq: 7,
          has_more: true,
        }),
      })
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 3, 50)

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual({
        events: [makeEvent({ seq: 7 })], // payload re-stringified back to "{...}"
        nextSeq: 7,
        hasMore: true,
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/sync/events")
      expect(url).toContain("list_id=list-1")
      expect(url).toContain("since_seq=3")
      expect(url).toContain("limit=50")
      expect(options.headers.Authorization).toBe("Bearer valid-token")
    })

    it("defaults to an empty page when the server omits events", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          list_id: "list-1",
          next_seq: 0,
          has_more: false,
        }),
      })
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 0)

      expect(result.getValue()).toEqual({
        events: [],
        nextSeq: 0,
        hasMore: false,
      })
    })

    it("treats a non-ok response as retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 })
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 0)

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
    })

    it("treats a 403 as non-retryable", async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 403 })
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 0)

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
    })

    it("treats being signed out as non-retryable, without fetching", async () => {
      mockGetValidAccessToken.mockResolvedValue(Result.ok(null))
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 0)

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a missing/unrefreshable token as retryable, without fetching", async () => {
      mockGetValidAccessToken.mockResolvedValue(
        Result.fail(new Error("refresh failed"))
      )
      const fetchMock = jest.fn()
      const client = new SyncClient(fetchMock)

      const result = await client.getEventsSince("list-1", 0)

      expect(result.success).toBe(false)
      expect(result.getError().retryable).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
