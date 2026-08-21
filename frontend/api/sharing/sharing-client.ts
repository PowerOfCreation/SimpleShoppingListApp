import { getValidAccessToken } from "@/api/auth/auth-service"
import { createLogger } from "@/api/common/logger"
import { Result } from "@/api/common/result"
import { SharingError, SharingErrorKind } from "@/api/common/error-types"
import { sharingConfig } from "./config"

const logger = createLogger("SharingClient")

const REQUEST_TIMEOUT_MS = 10000

/**
 * The validity presets the backend accepts. Not free-form: the server
 * validates against exactly this list (entities.ParseInviteTTL) and answers
 * anything else with 400, so offering a different value in the UI could only
 * ever produce an error.
 */
export const INVITE_TTLS = ["1h", "24h", "7d", "30d"] as const

export type InviteTTL = (typeof INVITE_TTLS)[number]

/**
 * An active invite as the *listing* endpoint returns it - deliberately
 * without a token. The plaintext exists exactly once, in the create
 * response; only its hash is stored (sync-sharing-target.md §4.3). An
 * existing link can therefore be revoked but never shown again.
 */
export type ListInvite = {
  inviteId: string
  createdBy: string
  createdAt: number | null
  expiresAt: number | null
}

/** The create response - the only shape that ever carries a token. */
export type CreatedInvite = {
  inviteId: string
  listId: string
  token: string
  createdAt: number | null
  expiresAt: number | null
}

/**
 * The redeem response - deliberately name-less (sync-sharing-target.md §4.3):
 * the server has nothing else to say about a list it never parses. The
 * list's name arrives later, from the first `todo_list.created` event a
 * post-redeem pull applies.
 */
export type RedeemedInvite = {
  listId: string
  role: string
  alreadyMember: boolean
}

export type FetchLike = typeof fetch

type WireInvite = {
  invite_id?: unknown
  created_by?: unknown
  created_at?: unknown
  expires_at?: unknown
}

type WireCreatedInvite = WireInvite & {
  list_id?: unknown
  token?: unknown
}

type WireRedeemedInvite = {
  list_id?: unknown
  role?: unknown
  already_member?: unknown
}

/**
 * The sharing DTOs carry Go `time.Time` values, i.e. RFC 3339 strings -
 * unlike the sync wire shapes, where occurred_at is epoch ms.
 *
 * Anything unparseable becomes null rather than NaN or a 1970 date: an
 * invite whose timestamps we cannot read is still a live link the owner may
 * want to revoke, so it has to survive into the list - just without a date.
 */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 404 means different things depending on what was addressed - a list the
 * server doesn't know yet needs one successful push, while an invite or
 * redeem token it doesn't know is simply gone/invalid. `subject` is which of
 * the three the request was about.
 */
function errorForStatus(
  status: number,
  subject: "list" | "invite" | "redeem"
): SharingError {
  const map: Record<number, [string, SharingErrorKind]> = {
    400: ["The server rejected the request", "invalid"],
    401: ["Your session is no longer valid", "unauthenticated"],
    403: ["Only the owner of this list can manage its invites", "notOwner"],
    404:
      subject === "list"
        ? ["The server does not know this list yet", "listUnknown"]
        : ["This invite no longer exists", "inviteGone"],
    410: ["This invite is no longer valid", "inviteGone"],
  }
  const known = map[status]
  if (known) {
    return new SharingError(known[0], known[1])
  }
  return new SharingError(`Unexpected response status ${status}`, "server")
}

type RequestSpec = {
  url: string
  method: "GET" | "POST" | "DELETE"
  body?: string
  subject: "list" | "invite" | "redeem"
  networkErrorMessage: string
}

/**
 * Manages a list's invite links over REST. Every route here is owner-only
 * server-side; the client cannot know its own role up front (there is no
 * membership endpoint yet, see sync-sharing-target.md §5), so a non-owner
 * finds out through a "notOwner" SharingError rather than a hidden button.
 */
export class SharingClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async getAuthToken(): Promise<Result<string, SharingError>> {
    const tokenResult = await getValidAccessToken()
    if (!tokenResult.success) {
      // Reaching here means the refresh itself failed - an expired or
      // revoked refresh token (see auth-service.refreshSession), not a
      // request that could be retried into working.
      return Result.fail(
        new SharingError(
          "Could not refresh your session",
          "unauthenticated",
          tokenResult.getError()
        )
      )
    }
    const token = tokenResult.getValue()
    if (!token) {
      return Result.fail(
        new SharingError("You are not signed in", "unauthenticated")
      )
    }
    return Result.ok(token)
  }

  /**
   * One authenticated request under REQUEST_TIMEOUT_MS, with every non-2xx
   * already mapped to a SharingError. Callers only deal with a Response they
   * know is successful.
   */
  private async request(
    spec: RequestSpec
  ): Promise<Result<Response, SharingError>> {
    const tokenResult = await this.getAuthToken()
    if (!tokenResult.success) {
      return Result.fail(tokenResult.getError())
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokenResult.getValue()}`,
    }
    if (spec.body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.fetchImpl(spec.url, {
        method: spec.method,
        headers,
        body: spec.body,
        signal: controller.signal,
      })
    } catch (error) {
      logger.warn(spec.networkErrorMessage, error)
      return Result.fail(
        new SharingError(spec.networkErrorMessage, "network", error)
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      return Result.fail(errorForStatus(response.status, spec.subject))
    }
    return Result.ok(response)
  }

  private async parseJson(
    response: Response,
    what: string
  ): Promise<Result<unknown, SharingError>> {
    try {
      return Result.ok(await response.json())
    } catch (error) {
      logger.warn(`Could not read the ${what} response body`, error)
      return Result.fail(
        new SharingError(
          `The server's ${what} response was unreadable`,
          "server",
          error
        )
      )
    }
  }

  /**
   * The list's currently active invites, newest first - the server orders by
   * created_at DESC (GetActiveListInvites) and this preserves that order
   * rather than imposing a second one. Revoked and expired invites are
   * filtered out server-side, so everything returned here is a link that
   * still works.
   */
  async getInvites(
    listId: string
  ): Promise<Result<ListInvite[], SharingError>> {
    const responseResult = await this.request({
      url: sharingConfig.listInvitesUrl(listId),
      method: "GET",
      subject: "list",
      networkErrorMessage: "Network error while loading invite links",
    })
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }

    const bodyResult = await this.parseJson(
      responseResult.getValue()!,
      "invite list"
    )
    if (!bodyResult.success) {
      return Result.fail(bodyResult.getError())
    }

    const body = bodyResult.getValue() as { invites?: WireInvite[] }
    const invites = Array.isArray(body?.invites) ? body.invites : []
    return Result.ok(
      invites.flatMap((invite) =>
        typeof invite?.invite_id === "string"
          ? [
              {
                inviteId: invite.invite_id,
                createdBy:
                  typeof invite.created_by === "string"
                    ? invite.created_by
                    : "",
                createdAt: parseTimestamp(invite.created_at),
                expiresAt: parseTimestamp(invite.expires_at),
              },
            ]
          : []
      )
    )
  }

  /**
   * Creates a multi-use invite link valid for `ttl`.
   *
   * The token in the response cannot be fetched again later, so a body that
   * doesn't parse is a real (if rare) loss: the invite exists server-side but
   * its link is gone. That surfaces as a "server" error, and the invite shows
   * up in the next getInvites() call - tokenless, and revocable.
   */
  async createInvite(
    listId: string,
    ttl: InviteTTL
  ): Promise<Result<CreatedInvite, SharingError>> {
    const responseResult = await this.request({
      url: sharingConfig.listInvitesUrl(listId),
      method: "POST",
      body: JSON.stringify({ ttl }),
      subject: "list",
      networkErrorMessage: "Network error while creating an invite link",
    })
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }

    const bodyResult = await this.parseJson(
      responseResult.getValue()!,
      "created invite"
    )
    if (!bodyResult.success) {
      return Result.fail(bodyResult.getError())
    }

    const body = bodyResult.getValue() as WireCreatedInvite
    if (typeof body?.token !== "string" || typeof body.invite_id !== "string") {
      return Result.fail(
        new SharingError(
          "The server did not return a usable invite link",
          "server"
        )
      )
    }

    return Result.ok({
      inviteId: body.invite_id,
      listId: typeof body.list_id === "string" ? body.list_id : listId,
      token: body.token,
      createdAt: parseTimestamp(body.created_at),
      expiresAt: parseTimestamp(body.expires_at),
    })
  }

  /**
   * Revokes an invite. The server answers 204 and treats revoking an
   * already-revoked invite as a no-op, so this is safe to retry.
   */
  async revokeInvite(inviteId: string): Promise<Result<void, SharingError>> {
    const responseResult = await this.request({
      url: sharingConfig.inviteUrl(inviteId),
      method: "DELETE",
      subject: "invite",
      networkErrorMessage: "Network error while revoking the invite link",
    })
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }
    return Result.ok<void, SharingError>(null)
  }

  /**
   * Joins the list a token points at. Idempotent server-side: an already-a-
   * member caller gets `already_member: true` back instead of an error, so a
   * retry of a lost response is always safe (sync-design-decisions.md).
   */
  async redeemInvite(
    token: string
  ): Promise<Result<RedeemedInvite, SharingError>> {
    const responseResult = await this.request({
      url: sharingConfig.redeemInviteUrl(),
      method: "POST",
      body: JSON.stringify({ token }),
      subject: "redeem",
      networkErrorMessage: "Network error while joining the list",
    })
    if (!responseResult.success) {
      return Result.fail(responseResult.getError())
    }

    const bodyResult = await this.parseJson(
      responseResult.getValue()!,
      "redeem"
    )
    if (!bodyResult.success) {
      return Result.fail(bodyResult.getError())
    }

    const body = bodyResult.getValue() as WireRedeemedInvite
    if (typeof body?.list_id !== "string") {
      return Result.fail(
        new SharingError(
          "The server did not say which list this joins",
          "server"
        )
      )
    }

    return Result.ok({
      listId: body.list_id,
      role: typeof body.role === "string" ? body.role : "member",
      alreadyMember: body.already_member === true,
    })
  }
}

/**
 * Shared instance for the screens. Sharing is a plain request/response
 * feature with no background state, so it needs neither a provider nor the
 * lifecycle SyncEngine has.
 */
export const sharingClient = new SharingClient()
