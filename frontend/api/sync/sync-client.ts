import { getValidAccessToken } from "@/api/auth/auth-service"
import { syncConfig } from "@/api/sync/config"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { SyncError } from "@/api/common/error-types"
import { DomainEventRow } from "@/types/DomainEvent"

const logger = createLogger("SyncClient")

const REQUEST_TIMEOUT_MS = 10000

/**
 * The wire shape the backend's SyncEventRequest expects. Notably:
 * - occurred_at is a plain epoch-ms number, matching how it's stored
 *   locally and how the backend DTO is being changed to parse it.
 * - payload must be embedded as an actual JSON value (matching Go's
 *   json.RawMessage), not as a JSON-encoded *string* - DomainEventRow.payload
 *   is stored locally as a string (the result of JSON.stringify), so it has
 *   to be parsed back into a value before going into the outer
 *   JSON.stringify for the request body. Sending it as a string would embed
 *   escaped quotes and fail to bind on the server.
 */
type WireEvent = {
  event_id: string
  event_type: string
  aggregate_id: string
  aggregate_type: string
  list_id: string | null
  occurred_at: number
  client_id: string
  payload: unknown
}

function toWireEvent(event: DomainEventRow): WireEvent {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    aggregate_id: event.aggregate_id,
    aggregate_type: event.aggregate_type,
    list_id: event.list_id,
    occurred_at: event.occurred_at,
    client_id: event.client_id,
    payload: JSON.parse(event.payload),
  }
}

/**
 * The shape GET /api/v1/sync/events actually returns - the same fields as
 * WireEvent (see mapper.ToSyncEventResponse on the backend, which builds
 * pull responses from the exact same StoredEvent push already round-trips
 * through), plus seq. fromWireEvent is toWireEvent's inverse: it turns a
 * server event back into the locally-stored shape (payload re-stringified,
 * seq dropped - seq lives in sync_cursors, not on the event row itself).
 */
type WireEventFromServer = {
  event_id: string
  event_type: string
  aggregate_id: string
  aggregate_type: string
  list_id: string | null
  occurred_at: number
  client_id: string
  payload: unknown
  seq: number
}

function fromWireEvent(event: WireEventFromServer): DomainEventRow {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    aggregate_id: event.aggregate_id,
    aggregate_type: event.aggregate_type,
    list_id: event.list_id,
    occurred_at: event.occurred_at,
    client_id: event.client_id,
    payload: JSON.stringify(event.payload),
  }
}

export type ListHead = {
  listId: string
  seq: number
  eventId: string | null
}

export type EventsPage = {
  events: DomainEventRow[]
  nextSeq: number
  hasMore: boolean
}

export type FetchLike = typeof fetch

/**
 * Sends already-persisted events to the backend over HTTP. A successful
 * call only means the server durably received and queued the events (the
 * backend responds 202 before it has actually written them) - it is not
 * confirmation they're committed. That confirmation comes later, out of
 * band, as a WebSocket ack (see sync-socket.ts / sync-engine.ts); this
 * client only ever reports "sent" or "failed to send".
 */
export class SyncClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async sendEvents(events: DomainEventRow[]): Promise<Result<void, SyncError>> {
    if (events.length === 0) {
      return Result.ok(undefined)
    }

    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success) {
      // Couldn't even ask for a token (e.g. refresh failed) - worth
      // retrying later, the outbox row stays pending either way.
      return Result.fail(
        new SyncError(
          "Could not obtain an access token",
          true,
          tokenResult.getError()
        )
      )
    }

    const token = tokenResult.getValue()
    if (!token) {
      // Not signed in. Callers are expected to gate flushing on being
      // signed in already; this is a defensive fallback, not the normal
      // path, so it isn't worth retrying on its own.
      return Result.fail(new SyncError("Not signed in", false))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await this.fetchImpl(syncConfig.eventsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(events.map(toWireEvent)),
        signal: controller.signal,
      })

      if (response.status === 401) {
        return Result.fail(new SyncError("Unauthorized", false))
      }

      if (!response.ok) {
        return Result.fail(
          new SyncError(`Unexpected response status ${response.status}`, true)
        )
      }

      return Result.ok(undefined)
    } catch (error) {
      logger.warn("Failed to send events", error)
      return Result.fail(
        new SyncError("Network error while sending events", true, error)
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Reconcile: for a set of sync-enabled aggregate (list) ids, asks the
   * server which event ids it actually has durably stored. Anything we
   * believe is synced but isn't in the response goes back to pending and
   * gets resent - the self-heal path. Aggregate ids rather than event ids
   * because that's what the app tracks per list; the server maps each
   * aggregate to the events it holds for it.
   */
  async getKnownEventIds(
    aggregateIds: string[]
  ): Promise<Result<string[], SyncError>> {
    if (aggregateIds.length === 0) {
      return Result.ok([])
    }

    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success || !tokenResult.getValue()) {
      return Result.fail(new SyncError("Not signed in", false))
    }
    const token = tokenResult.getValue()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await this.fetchImpl(syncConfig.syncStateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aggregate_ids: aggregateIds }),
        signal: controller.signal,
      })

      if (!response.ok) {
        return Result.fail(
          new SyncError(`Unexpected response status ${response.status}`, true)
        )
      }

      const data = (await response.json()) as { known_event_ids?: string[] }
      return Result.ok(data.known_event_ids ?? [])
    } catch (error) {
      logger.warn("Failed to reconcile with the server", error)
      return Result.fail(
        new SyncError("Network error while reconciling", true, error)
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * The pull decision point: for a set of sync-enabled list ids, asks the
   * server for each list's current head (seq + latest event id). The
   * engine compares this against its local cursor to decide whether to
   * pull, push, or do nothing (see SyncEngine.pull).
   */
  async getListHeads(
    listIds: string[]
  ): Promise<Result<ListHead[], SyncError>> {
    if (listIds.length === 0) {
      return Result.ok([])
    }

    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success || !tokenResult.getValue()) {
      return Result.fail(new SyncError("Not signed in", false))
    }
    const token = tokenResult.getValue()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await this.fetchImpl(syncConfig.syncHeadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ list_ids: listIds }),
        signal: controller.signal,
      })

      if (!response.ok) {
        return Result.fail(
          new SyncError(`Unexpected response status ${response.status}`, true)
        )
      }

      const data = (await response.json()) as {
        heads?: { list_id: string; seq: number; event_id: string | null }[]
      }
      const heads = (data.heads ?? []).map((h) => ({
        listId: h.list_id,
        seq: h.seq,
        eventId: h.event_id,
      }))
      return Result.ok(heads)
    } catch (error) {
      logger.warn("Failed to fetch list heads", error)
      return Result.fail(
        new SyncError("Network error while fetching list heads", true, error)
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Pulls one page of a list's event history, strictly ordered by seq and
   * starting after sinceSeq. Mirrors sendEvents' wire shape in reverse -
   * fromWireEvent turns each event straight back into a DomainEventRow the
   * applier can insert.
   */
  async getEventsSince(
    listId: string,
    sinceSeq: number,
    limit = 200
  ): Promise<Result<EventsPage, SyncError>> {
    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success || !tokenResult.getValue()) {
      return Result.fail(new SyncError("Not signed in", false))
    }
    const token = tokenResult.getValue()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const url = `${syncConfig.syncEventsUrl}?list_id=${encodeURIComponent(listId)}&since_seq=${sinceSeq}&limit=${limit}`
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })

      if (!response.ok) {
        return Result.fail(
          new SyncError(`Unexpected response status ${response.status}`, true)
        )
      }

      const data = (await response.json()) as {
        events?: WireEventFromServer[]
        next_seq: number
        has_more: boolean
      }
      return Result.ok({
        events: (data.events ?? []).map(fromWireEvent),
        nextSeq: data.next_seq,
        hasMore: data.has_more,
      })
    } catch (error) {
      logger.warn("Failed to pull events", error)
      return Result.fail(
        new SyncError("Network error while pulling events", true, error)
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}
