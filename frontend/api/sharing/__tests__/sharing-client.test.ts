import { SharingClient } from "../sharing-client"
import { Result } from "@/api/common/result"

import { getValidAccessToken } from "@/api/auth/auth-service"

jest.mock("@/api/auth/auth-service", () => ({
  getValidAccessToken: jest.fn(),
}))
const mockGetValidAccessToken = getValidAccessToken as jest.Mock

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const emptyResponse = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new Error("no body")
  },
})

describe("SharingClient", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetValidAccessToken.mockResolvedValue(Result.ok("valid-token"))
  })

  describe("getInvites", () => {
    it("requests the list's invites and maps the wire shape", async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          invites: [
            {
              invite_id: "invite-1",
              created_by: "user-1",
              created_at: "2026-08-20T10:00:00Z",
              expires_at: "2026-08-27T10:00:00Z",
            },
          ],
        })
      )
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([
        {
          inviteId: "invite-1",
          createdBy: "user-1",
          createdAt: Date.parse("2026-08-20T10:00:00Z"),
          expiresAt: Date.parse("2026-08-27T10:00:00Z"),
        },
      ])

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/todo-lists/list-1/invites")
      expect(options.method).toBe("GET")
      expect(options.headers.Authorization).toBe("Bearer valid-token")
    })

    it("keeps an invite whose timestamps are unreadable, without a date", async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          invites: [
            {
              invite_id: "invite-1",
              created_by: "user-1",
              created_at: "not-a-date",
              expires_at: null,
            },
          ],
        })
      )
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.getValue()).toEqual([
        {
          inviteId: "invite-1",
          createdBy: "user-1",
          createdAt: null,
          expiresAt: null,
        },
      ])
    })

    it("returns an empty list when the body has no invites array", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, {}))
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual([])
    })

    // 404 on a list means the server holds no log for it yet, which is
    // fixable by syncing - quite unlike a 404 on an invite.
    it("maps a 404 on a list to listUnknown", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse(404, {}))
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.success).toBe(false)
      expect(result.getError().kind).toBe("listUnknown")
    })

    it("maps a 403 to notOwner", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse(403, {}))
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.getError().kind).toBe("notOwner")
    })

    it("maps a transport failure to a network error", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new Error("offline"))
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.getError().kind).toBe("network")
    })

    it("fails without hitting the network when not signed in", async () => {
      mockGetValidAccessToken.mockResolvedValue(Result.ok(null))
      const fetchMock = jest.fn()
      const client = new SharingClient(fetchMock)

      const result = await client.getInvites("list-1")

      expect(result.getError().kind).toBe("unauthenticated")
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe("createInvite", () => {
    it("posts the chosen ttl and returns the one-time token", async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(201, {
          invite_id: "invite-1",
          list_id: "list-1",
          token: "plaintext-token",
          created_at: "2026-08-20T10:00:00Z",
          expires_at: "2026-08-21T10:00:00Z",
        })
      )
      const client = new SharingClient(fetchMock)

      const result = await client.createInvite("list-1", "24h")

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual({
        inviteId: "invite-1",
        listId: "list-1",
        token: "plaintext-token",
        createdAt: Date.parse("2026-08-20T10:00:00Z"),
        expiresAt: Date.parse("2026-08-21T10:00:00Z"),
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/todo-lists/list-1/invites")
      expect(options.method).toBe("POST")
      expect(options.headers["Content-Type"]).toBe("application/json")
      expect(JSON.parse(options.body)).toEqual({ ttl: "24h" })
    })

    // A created invite without a readable token is unusable: the plaintext
    // exists nowhere else. Better an explicit failure than a screen showing
    // "undefined" as a link.
    it("fails when the response carries no token", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(jsonResponse(201, { invite_id: "invite-1" }))
      const client = new SharingClient(fetchMock)

      const result = await client.createInvite("list-1", "24h")

      expect(result.success).toBe(false)
      expect(result.getError().kind).toBe("server")
    })

    it("maps a rejected ttl to an invalid request", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse(400, {}))
      const client = new SharingClient(fetchMock)

      const result = await client.createInvite("list-1", "24h")

      expect(result.getError().kind).toBe("invalid")
    })
  })

  describe("revokeInvite", () => {
    it("deletes the invite and succeeds on the empty 204 body", async () => {
      const fetchMock = jest.fn().mockResolvedValue(emptyResponse(204))
      const client = new SharingClient(fetchMock)

      const result = await client.revokeInvite("invite-1")

      expect(result.success).toBe(true)

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain("/api/v1/invites/invite-1")
      expect(options.method).toBe("DELETE")
    })

    it("maps a 404 on an invite to inviteGone, not listUnknown", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse(404, {}))
      const client = new SharingClient(fetchMock)

      const result = await client.revokeInvite("invite-1")

      expect(result.getError().kind).toBe("inviteGone")
    })
  })
})
