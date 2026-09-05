import React from "react"

import { createLogger } from "@/api/common/logger"
import { SharingError } from "@/api/common/error-types"
import {
  CreatedInvite,
  InviteTTL,
  ListInvite,
  sharingClient,
} from "@/api/sharing/sharing-client"

const logger = createLogger("useListInvites")

/**
 * Turns a failure into something the owner can act on. Every branch names
 * the next step, because each of these is recoverable: sign in again, put
 * the list on the server once, or stop trying (it isn't yours).
 */
export function describeSharingError(error: SharingError): string {
  switch (error.kind) {
    case "unauthenticated":
      return "Your session expired. Sign in again to manage invites."
    case "notOwner":
      return "Only the owner of this list can invite people to it."
    case "listUnknown":
      return (
        "The server does not know this list yet. It is uploaded the first " +
        "time this device syncs it - try again in a moment."
      )
    case "inviteGone":
      return "That invite link was already revoked or has expired."
    case "invalid":
      return "The server rejected the request."
    case "network":
      return "Could not reach the server. Check your connection and retry."
    case "server":
      return "The server ran into a problem. Please try again."
  }
}

/**
 * State for the invite screen of one list: the active links, creating a new
 * one, and revoking an existing one.
 *
 * `enabled` gates every request. The screen still has to call this hook
 * unconditionally (rules of hooks), but there is no point asking the backend
 * about invites while signed out or without a backend URL - the answer would
 * be a 401 dressed up as an error message.
 *
 * `listName` is only used for createInvite - see SharingClient.createInvite
 * for why the client, not the server, supplies it.
 */
export function useListInvites(
  listId: string,
  listName: string,
  enabled: boolean
) {
  const [invites, setInvites] = React.useState<ListInvite[]>([])
  const [isLoading, setIsLoading] = React.useState(enabled)
  const [error, setError] = React.useState<SharingError | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [revokingInviteId, setRevokingInviteId] = React.useState<string | null>(
    null
  )
  /**
   * When the invites on screen were fetched. Rows measure "expires in ..."
   * against this instead of reading a clock while rendering, so every row
   * of one load agrees on the current time and re-rendering can't shift it.
   * 0 until the first load - by which point there are no rows to date.
   */
  const [loadedAt, setLoadedAt] = React.useState(0)
  /**
   * The link that was just created, kept in state because it can never be
   * fetched again: only the token's hash is stored server-side. Cleared by
   * dismissNewInvite once the owner has shared or copied it.
   */
  const [newInvite, setNewInvite] = React.useState<CreatedInvite | null>(null)

  const refresh = React.useCallback(
    async (options?: { background?: boolean }) => {
      if (!enabled || !listId) {
        setIsLoading(false)
        return
      }
      // A reload that follows a create or a revoke must not blank the list
      // already on screen: the spinner would replace the very row whose
      // revoke is still in flight.
      if (!options?.background) {
        setIsLoading(true)
      }
      const result = await sharingClient.getInvites(listId)
      if (result.success) {
        setInvites(result.getValue()!)
        setLoadedAt(Date.now())
        setError(null)
      } else {
        const sharingError = result.getError()
        logger.warn("Could not load invite links", sharingError)
        setError(sharingError)
      }
      setIsLoading(false)
    },
    [enabled, listId]
  )

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const createInvite = React.useCallback(
    async (ttl: InviteTTL) => {
      if (!enabled || !listId) return
      setIsCreating(true)
      const result = await sharingClient.createInvite(listId, ttl, listName)
      if (result.success) {
        setNewInvite(result.getValue())
        setError(null)
        // The new link belongs in the active list too - reload rather than
        // splicing it in, so the screen keeps showing exactly what the
        // server considers active.
        await refresh({ background: true })
      } else {
        const sharingError = result.getError()
        logger.warn("Could not create an invite link", sharingError)
        setError(sharingError)
      }
      setIsCreating(false)
    },
    [enabled, listId, listName, refresh]
  )

  const revokeInvite = React.useCallback(
    async (inviteId: string) => {
      if (!enabled) return
      setRevokingInviteId(inviteId)
      const result = await sharingClient.revokeInvite(inviteId)
      // Reload either way: a revoke that failed because the invite was
      // already gone leaves the list stale in exactly the same way a
      // successful one does.
      await refresh({ background: true })
      // Reported *after* the reload, whose own success clears the error -
      // otherwise a rejected revoke (403, 500) would leave the row in place
      // and say nothing about why.
      if (result.success) {
        setError(null)
      } else {
        const sharingError = result.getError()
        logger.warn("Could not revoke the invite link", sharingError)
        setError(sharingError)
      }
      setRevokingInviteId(null)
    },
    [enabled, refresh]
  )

  const dismissNewInvite = React.useCallback(() => setNewInvite(null), [])

  return {
    invites,
    /** Reference time for the loaded invites - see loadedAt. */
    now: loadedAt,
    isLoading,
    error,
    errorMessage: error ? describeSharingError(error) : null,
    refresh,
    createInvite,
    isCreating,
    newInvite,
    dismissNewInvite,
    revokeInvite,
    revokingInviteId,
  }
}
