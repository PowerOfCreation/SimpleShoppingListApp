import { SyncSocket } from "../sync-socket"
import { Result } from "@/api/common/result"
import { flushMicrotasks } from "../test-helpers"

import { getValidAccessToken } from "@/api/auth/auth-service"

jest.mock("@/api/auth/auth-service", () => ({
  getValidAccessToken: jest.fn(),
}))
jest.mock("@/api/common/client-id", () => ({
  getClientId: jest.fn(() => "client-1"),
}))
const mockGetValidAccessToken = getValidAccessToken as jest.Mock

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  closeCalls = 0

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls++
    this.onclose?.()
  }

  triggerOpen() {
    this.onopen?.()
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe("SyncSocket", () => {
  let createdSockets: FakeSocket[]
  let createSocket: jest.Mock
  let onAck: jest.Mock
  let onConnected: jest.Mock
  let onListEvent: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    createdSockets = []
    createSocket = jest.fn((_url: string, _headers) => {
      const socket = new FakeSocket()
      createdSockets.push(socket)
      return socket as unknown as WebSocket
    })
    onAck = jest.fn()
    onConnected = jest.fn()
    onListEvent = jest.fn()
    mockGetValidAccessToken.mockResolvedValue(Result.ok("token-1"))
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  function makeSocket() {
    return new SyncSocket(onAck, onConnected, onListEvent, createSocket)
  }

  it("connects with the client id in the URL and the token as a bearer header", async () => {
    const socket = makeSocket()
    await socket.connect()

    expect(createSocket).toHaveBeenCalledTimes(1)
    const [url, headers] = createSocket.mock.calls[0]
    expect(url).toContain("client_id=client-1")
    expect(url).toContain("/api/v1/sync/ws")
    expect(headers).toEqual({ Authorization: "Bearer token-1" })
  })

  it("connects without an Authorization header when there is no token", async () => {
    mockGetValidAccessToken.mockResolvedValue(Result.ok(null))
    const socket = makeSocket()
    await socket.connect()

    const [, headers] = createSocket.mock.calls[0]
    expect(headers).toBeUndefined()
  })

  it("calls onConnected when the socket opens", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerOpen()

    expect(onConnected).toHaveBeenCalledTimes(1)
  })

  it("does not open a second socket while one is already connecting/connected", async () => {
    const socket = makeSocket()
    await socket.connect()
    await socket.connect()

    expect(createSocket).toHaveBeenCalledTimes(1)
  })

  it("sends a ping every 50 seconds after opening, as long as pongs keep arriving", async () => {
    const socket = makeSocket()
    await socket.connect()
    const fake = createdSockets[0]
    fake.triggerOpen()

    jest.advanceTimersByTime(50_000)
    expect(fake.sent).toEqual([JSON.stringify({ type: "ping" })])
    fake.triggerMessage({ type: "pong" }) // keep the connection alive

    jest.advanceTimersByTime(50_000)
    expect(fake.sent).toHaveLength(2)
  })

  it("clears the pong timeout when a pong arrives", async () => {
    const socket = makeSocket()
    await socket.connect()
    const fake = createdSockets[0]
    fake.triggerOpen()

    jest.advanceTimersByTime(50_000) // sends a ping
    fake.triggerMessage({ type: "pong" })

    // No pong-timeout close should fire even after the timeout window passes.
    jest.advanceTimersByTime(10_000)
    expect(fake.closeCalls).toBe(0)
  })

  it("closes and reconnects when no pong arrives within the timeout", async () => {
    const socket = makeSocket()
    await socket.connect()
    const fake = createdSockets[0]
    fake.triggerOpen()

    jest.advanceTimersByTime(50_000) // sends a ping, starts the pong timer
    jest.advanceTimersByTime(10_000) // pong never arrives

    expect(fake.closeCalls).toBe(1)
  })

  it("calls onAck with the event id from an ack message", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerMessage({
      type: "ack",
      event_id: "evt-123",
      seq: 7,
    })

    expect(onAck).toHaveBeenCalledWith("evt-123")
  })

  it("calls onAck even with a malformed seq - seq has exactly one writer, the pull path, and is no longer read from an ack", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerMessage({
      type: "ack",
      event_id: "evt-123",
      seq: "not-a-number",
    })

    expect(onAck).toHaveBeenCalledWith("evt-123")
  })

  it("ignores an ack message with a malformed event_id", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerMessage({
      type: "ack",
      event_id: 123,
      seq: 7,
    })

    expect(onAck).not.toHaveBeenCalled()
  })

  it("calls onListEvent with the list id and seq from an event message", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerMessage({
      type: "event",
      list_id: "list-1",
      seq: 42,
    })

    expect(onListEvent).toHaveBeenCalledWith("list-1", 42)
  })

  it("ignores an event message with a malformed seq", async () => {
    const socket = makeSocket()
    await socket.connect()
    createdSockets[0].triggerMessage({
      type: "event",
      list_id: "list-1",
      seq: "not-a-number",
    })

    expect(onListEvent).not.toHaveBeenCalled()
  })

  describe("subscribe", () => {
    it("sends the subscribe frame immediately when already connected", async () => {
      const socket = makeSocket()
      await socket.connect()
      const fake = createdSockets[0]
      fake.triggerOpen()
      fake.sent = []

      socket.subscribe(["list-1", "list-2"])

      expect(fake.sent).toEqual([
        JSON.stringify({ type: "subscribe", list_ids: ["list-1", "list-2"] }),
      ])
    })

    it("does nothing (no throw) when called before a socket exists", async () => {
      const socket = makeSocket()
      expect(() => socket.subscribe(["list-1"])).not.toThrow()
    })

    it("resends the current subscription on every (re)connect, before onConnected fires", async () => {
      const callOrder: string[] = []
      onConnected.mockImplementation(() => callOrder.push("connected"))

      const socket = makeSocket()
      await socket.connect()
      socket.subscribe(["list-1"])

      const fake = createdSockets[0]
      const originalSend = fake.send.bind(fake)
      fake.send = (data: string) => {
        if (JSON.parse(data).type === "subscribe") {
          callOrder.push("subscribed")
        }
        originalSend(data)
      }

      fake.triggerOpen()

      expect(callOrder).toEqual(["subscribed", "connected"])
    })

    it("carries the subscription across a reconnect", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0) // deterministic: no jitter
      const socket = makeSocket()
      await socket.connect()
      socket.subscribe(["list-1"])

      createdSockets[0].close() // triggers reconnect
      jest.advanceTimersByTime(1_000)
      await flushMicrotasks()

      const reconnected = createdSockets[1]
      reconnected.sent = []
      reconnected.triggerOpen()

      expect(reconnected.sent).toEqual([
        JSON.stringify({ type: "subscribe", list_ids: ["list-1"] }),
      ])

      jest.restoreAllMocks()
    })

    it("a later subscribe() call replaces rather than adds to the list ids sent on the next open", async () => {
      const socket = makeSocket()
      await socket.connect()
      socket.subscribe(["list-1"])
      socket.subscribe(["list-2"])

      const fake = createdSockets[0]
      fake.sent = []
      fake.triggerOpen()

      expect(fake.sent).toEqual([
        JSON.stringify({ type: "subscribe", list_ids: ["list-2"] }),
      ])
    })
  })

  it("ignores malformed messages without throwing", async () => {
    const socket = makeSocket()
    await socket.connect()
    const fake = createdSockets[0]

    expect(() => fake.onmessage?.({ data: "not json" })).not.toThrow()
    expect(onAck).not.toHaveBeenCalled()
  })

  it("reconnects after a close with exponential backoff, capped", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0) // deterministic: no jitter
    const socket = makeSocket()
    await socket.connect()

    createdSockets[0].close() // triggers onclose -> scheduleReconnect(1s)
    jest.advanceTimersByTime(1_000)
    await flushMicrotasks() // let the async connect() continue
    expect(createSocket).toHaveBeenCalledTimes(2)

    createdSockets[1].close() // next backoff: 2s
    jest.advanceTimersByTime(2_000)
    await flushMicrotasks()
    expect(createSocket).toHaveBeenCalledTimes(3)

    jest.restoreAllMocks()
  })

  it("stops reconnecting once disconnect() is called", async () => {
    const socket = makeSocket()
    await socket.connect()
    const fake = createdSockets[0]

    socket.disconnect()
    expect(fake.closeCalls).toBe(1)

    jest.advanceTimersByTime(120_000)
    expect(createSocket).toHaveBeenCalledTimes(1)
  })

  it("does not create a socket if disconnect() is called while awaiting the token", async () => {
    let resolveToken!: (value: Result<string | null, Error>) => void
    mockGetValidAccessToken.mockReturnValue(
      new Promise((resolve) => {
        resolveToken = resolve
      })
    )

    const socket = makeSocket()
    const connectPromise = socket.connect()
    socket.disconnect()
    resolveToken(Result.ok("token-1"))
    await connectPromise

    expect(createSocket).not.toHaveBeenCalled()
  })

  describe("reconnectIfTokenChanged", () => {
    it("closes the socket when the token has changed since connecting", async () => {
      const socket = makeSocket()
      await socket.connect()
      const fake = createdSockets[0]

      mockGetValidAccessToken.mockResolvedValue(Result.ok("token-2"))
      await socket.reconnectIfTokenChanged()

      expect(fake.closeCalls).toBe(1)
    })

    it("does nothing when the token is unchanged", async () => {
      const socket = makeSocket()
      await socket.connect()
      const fake = createdSockets[0]

      await socket.reconnectIfTokenChanged()

      expect(fake.closeCalls).toBe(0)
    })

    it("does nothing when there is no active socket", async () => {
      const socket = makeSocket()
      await expect(socket.reconnectIfTokenChanged()).resolves.toBeUndefined()
    })
  })
})
