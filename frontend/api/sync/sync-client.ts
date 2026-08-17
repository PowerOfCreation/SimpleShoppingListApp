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
 * server event back into the locally-stored shape (payload re-stringified).
 * seq carries over rather than being dropped - it's the server's
 * authoritative replay position, see byServerSeqThenLocal.
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
    seq: event.seq,
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
 * 401 and 403 both mean retrying the exact same request is pointless: the
 * token is invalid/expired (401), or the caller has lost access to
 * something in the request - a list they were removed from, or a list_id
 * they were never a member of (403, enforced server-side by
 * ListAccessService - see sync-sharing-target.md §2). Anything else is
 * treated as possibly transient.
 */
function nonRetryableError(response: Response): SyncError | null {
  if (response.status === 401) {
    return new SyncError("Unauthorized", false)
  }
  if (response.status === 403) {
    return new SyncError("Forbidden", false)
  }
  return null
}

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

  /**
   * Resolves a bearer token, distinguishing "couldn't even ask" (e.g.
   * refresh failed - worth retrying) from "not signed in" (callers are
   * expected to gate on being signed in already, so this is a defensive
   * fallback, not worth retrying on its own).
   */
  private async getAuthToken(): Promise<Result<string, SyncError>> {
    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success) {
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
      return Result.fail(new SyncError("Not signed in", false))
    }
    return Result.ok(token)
  }

  /**
   * Runs one request under REQUEST_TIMEOUT_MS, mapping an abort/network
   * failure to a retryable SyncError. Does not interpret the response
   * (status checking and body parsing differ per endpoint) - callers get
   * the raw Response back on success.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    networkErrorMessage: string
  ): Promise<Result<Response, SyncError>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      })
      return Result.ok(response)
    } catch (error) {
      logger.warn(networkErrorMessage, error)
      return Result.fail(new SyncError(networkErrorMessage, true, error))
    } finally {
      clearTimeout(timeout)
    }
  }

  async sendEvents(events: DomainEventRow[]): Promise<Result<void, SyncError>> {
    if (events.length === 0) {
      return Result.ok(undefined)
    }

    const tokenResult = await this.getAuthToken()
    if (!tokenResult.success) {
      return Result.fail(tokenResult.getError())
    }

    const responseResult = await this.fetchWithTimeout(
      syncConfig.eventsUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResult.getValue()}`,
        },
        body: JSON.stringify(events.map(toWireEvent)),
      },
      "Network error while sending events"
    )
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }
    const response = responseResult.getValue()!

    if (!response.ok) {
      const nonRetryable = nonRetryableError(response)
      if (nonRetryable) {
        return Result.fail(nonRetryable)
      }
      return Result.fail(
        new SyncError(`Unexpected response status ${response.status}`, true)
      )
    }

    return Result.ok(undefined)
  }

  /**
   * Reconcile: for a set of sync-enabled list ids, asks the server which
   * event ids it actually has durably stored. Anything we believe is
   * synced but isn't in the response goes back to pending and gets resent
   * - the self-heal path. Keyed by list_id, not aggregate_id: aggregate_id
   * is the ingredient id for ingredient.* events, so a single list can
   * span arbitrarily many aggregate_ids but always has exactly one
   * list_id - see sync-design-decisions.md.
   */
  async getKnownEventIds(
    listIds: string[]
  ): Promise<Result<string[], SyncError>> {
    if (listIds.length === 0) {
      return Result.ok([])
    }

    const tokenResult = await this.getAuthToken()
    if (!tokenResult.success) {
      return Result.fail(tokenResult.getError())
    }

    const responseResult = await this.fetchWithTimeout(
      syncConfig.syncStateUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResult.getValue()}`,
        },
        body: JSON.stringify({ list_ids: listIds }),
      },
      "Network error while reconciling"
    )
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }
    const response = responseResult.getValue()!

    if (!response.ok) {
      const nonRetryable = nonRetryableError(response)
      if (nonRetryable) {
        return Result.fail(nonRetryable)
      }
      return Result.fail(
        new SyncError(`Unexpected response status ${response.status}`, true)
      )
    }

    const data = (await response.json()) as { known_event_ids?: string[] }
    return Result.ok(data.known_event_ids ?? [])
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

    const tokenResult = await this.getAuthToken()
    if (!tokenResult.success) {
      return Result.fail(tokenResult.getError())
    }

    const responseResult = await this.fetchWithTimeout(
      syncConfig.syncHeadUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResult.getValue()}`,
        },
        body: JSON.stringify({ list_ids: listIds }),
      },
      "Network error while fetching list heads"
    )
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }
    const response = responseResult.getValue()!

    if (!response.ok) {
      const nonRetryable = nonRetryableError(response)
      if (nonRetryable) {
        return Result.fail(nonRetryable)
      }
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
    const tokenResult = await this.getAuthToken()
    if (!tokenResult.success) {
      return Result.fail(tokenResult.getError())
    }

    const url = `${syncConfig.syncEventsUrl}?list_id=${encodeURIComponent(listId)}&since_seq=${sinceSeq}&limit=${limit}`
    const responseResult = await this.fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenResult.getValue()}` },
      },
      "Network error while pulling events"
    )
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }
    const response = responseResult.getValue()!

    if (!response.ok) {
      const nonRetryable = nonRetryableError(response)
      if (nonRetryable) {
        return Result.fail(nonRetryable)
      }
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
  }
}
