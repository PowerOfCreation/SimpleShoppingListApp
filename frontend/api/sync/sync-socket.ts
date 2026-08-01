import { getClientId } from "@/api/common/client-id"
import { getValidAccessToken } from "@/api/auth/auth-service"
import { syncConfig } from "@/api/sync/config"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("SyncSocket")

// The client pings every 50s (per the sync design) so no firewall/NAT
// along the way decides the connection is idle and drops it.
const PING_INTERVAL_MS = 50_000
const PONG_TIMEOUT_MS = 10_000
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000

export type AckHandler = (eventId: string) => void
export type ConnectedHandler = () => void

/**
 * React Native's WebSocket constructor does accept a third argument at
 * runtime (`new WebSocket(url, protocols, { headers })`), but the ambient
 * `WebSocket` type in this project is the DOM one (2-argument
 * constructor), because `tsconfig.json` inherits `lib: ["DOM", "ESNext"]`
 * from `expo/tsconfig.base` - RN doesn't re-export its own WebSocket type.
 * This local alias documents that gap explicitly rather than silencing it
 * with @ts-expect-error.
 */
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: Record<string, string> }
) => WebSocket

export type CreateSocket = (
  url: string,
  headers: Record<string, string> | undefined
) => WebSocket

const defaultCreateSocket: CreateSocket = (url, headers) => {
  const RNWebSocket = WebSocket as unknown as RNWebSocketCtor
  return new RNWebSocket(url, undefined, headers ? { headers } : undefined)
}

/**
 * Maintains a single persistent WebSocket connection for acks and
 * liveness. Sending events is never done over this socket (see
 * sync-client.ts) - this connection is receive-only from the app's
 * perspective, plus the app-level ping.
 *
 * The constructor takes an injectable `createSocket` because jest-expo
 * runs in a plain Node environment with no RN WebSocket implementation -
 * without injection this class would be untestable.
 */
export class SyncSocket {
  private socket: WebSocket | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private pongTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private backoffMs = INITIAL_BACKOFF_MS
  private stopped = true
  private connectedWithToken: string | null = null

  constructor(
    private readonly onAck: AckHandler,
    private readonly onConnected: ConnectedHandler,
    private readonly createSocket: CreateSocket = defaultCreateSocket
  ) {}

  async connect(): Promise<void> {
    if (this.socket) {
      // Already connected or connecting.
      return
    }
    this.stopped = false

    const tokenResult = await getValidAccessToken()
    const token = tokenResult.success ? tokenResult.getValue() : null
    this.connectedWithToken = token

    if (this.stopped) {
      // disconnect() was called while we were awaiting the token.
      return
    }

    const url = `${syncConfig.webSocketUrl}?client_id=${encodeURIComponent(getClientId())}`
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined

    let socket: WebSocket
    try {
      socket = this.createSocket(url, headers)
    } catch (error) {
      logger.warn("Failed to create WebSocket", error)
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.backoffMs = INITIAL_BACKOFF_MS
      this.startPing()
      this.onConnected()
    }

    socket.onmessage = (event) => {
      this.handleMessage(event.data)
    }

    socket.onclose = () => {
      this.cleanupTimers()
      this.socket = null
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    }

    // onerror is intentionally not handled separately: the WebSocket spec
    // (and RN's implementation) always follows an error with a close
    // event, which is where cleanup and reconnect already happen.
  }

  disconnect(): void {
    this.stopped = true
    this.cleanupTimers()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.socket?.close()
    this.socket = null
  }

  /**
   * Keycloak access tokens are typically short-lived (~5 minutes), far
   * shorter than a connection kept alive by 50s pings. Header auth can't
   * be refreshed on a live connection, so if the token has changed since
   * we connected, force a reconnect (onclose schedules it) rather than let
   * the socket sit there authenticated as a stale token.
   */
  async reconnectIfTokenChanged(): Promise<void> {
    if (!this.socket) {
      return
    }
    const tokenResult = await getValidAccessToken()
    const token = tokenResult.success ? tokenResult.getValue() : null
    if (token !== this.connectedWithToken) {
      this.socket.close()
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (error) {
      logger.warn("Failed to parse WebSocket message", error)
      return
    }
    if (!parsed || typeof parsed !== "object") {
      return
    }
    const message = parsed as { type?: unknown; event_id?: unknown }

    if (message.type === "pong") {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout)
        this.pongTimeout = null
      }
      return
    }

    if (message.type === "ack" && typeof message.event_id === "string") {
      this.onAck(message.event_id)
    }
  }

  private startPing(): void {
    this.clearPingTimers()
    this.pingInterval = setInterval(() => {
      this.sendPing()
    }, PING_INTERVAL_MS)
  }

  private sendPing(): void {
    if (!this.socket) {
      return
    }
    try {
      this.socket.send(JSON.stringify({ type: "ping" }))
    } catch (error) {
      logger.warn("Failed to send ping", error)
      return
    }
    // If no pong arrives before the next ping is due, the connection is
    // presumed dead - closing it triggers onclose's reconnect logic.
    this.pongTimeout = setTimeout(() => {
      logger.warn("Pong timeout, reconnecting")
      this.socket?.close()
    }, PONG_TIMEOUT_MS)
  }

  private clearPingTimers(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }
  }

  private cleanupTimers(): void {
    this.clearPingTimers()
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return
    }
    const jitter = Math.random() * 0.3 * this.backoffMs
    const delay = Math.min(this.backoffMs + jitter, MAX_BACKOFF_MS)
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.connect()
    }, delay)
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
  }
}
