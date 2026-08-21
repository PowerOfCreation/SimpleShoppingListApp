import React from "react"

import { createLogger } from "@/api/common/logger"
import { SharingError } from "@/api/common/error-types"
import { RedeemedInvite, sharingClient } from "@/api/sharing/sharing-client"
import { getDatabase } from "@/database/database"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { SyncEngine } from "@/api/sync/sync-engine"

const logger = createLogger("useRedeemInvite")

export type RedeemStatus =
  "idle" | "redeeming" | "syncing" | "success" | "error"

/**
 * Turns a redeem failure into something the person tapping "Join" can act
 * on. Unlike useListInvites' describeSharingError, there is no owner-only
 * concept here - any signed-in caller can redeem a token.
 */
export function describeRedeemError(error: SharingError): string {
  switch (error.kind) {
    case "unauthenticated":
      return "Your session expired. Sign in again to join this list."
    case "inviteGone":
      return "This invite link is invalid, was revoked, or has expired."
    case "invalid":
      return "That doesn't look like a valid invite link or token."
    case "network":
      return "Could not reach the server. Check your connection and retry."
    case "notOwner":
    case "listUnknown":
    case "server":
      return "The server ran into a problem. Please try again."
  }
}

/**
 * Redeems an invite token and pulls the list it points at down onto this
 * device. The redeem response carries no list name (sync-sharing-target.md
 * §4.3) - enabling sync and pulling is what actually creates the list
 * locally, name included, from its event history.
 */
export function useRedeemInvite(enabled: boolean, engine: SyncEngine) {
  const [status, setStatus] = React.useState<RedeemStatus>("idle")
  const [error, setError] = React.useState<SharingError | null>(null)
  const [result, setResult] = React.useState<RedeemedInvite | null>(null)

  const redeem = React.useCallback(
    async (token: string) => {
      if (!enabled || !token.trim()) return
      setStatus("redeeming")
      setError(null)

      const redeemResult = await sharingClient.redeemInvite(token.trim())
      if (!redeemResult.success) {
        const sharingError = redeemResult.getError()
        logger.warn("Could not redeem the invite", sharingError)
        setError(sharingError)
        setStatus("error")
        return
      }

      const redeemed = redeemResult.getValue()!
      setStatus("syncing")
      try {
        await new ListSyncSettingsRepository(getDatabase()).setEnabled(
          redeemed.listId,
          true
        )
        await engine.pullList(redeemed.listId)
      } catch (err) {
        // Membership already exists server-side at this point - a failed
        // local pull just means the list shows up on the next normal sync
        // cycle rather than immediately. Not worth surfacing as an error.
        logger.warn("Could not pull the joined list locally yet", err)
      }

      setResult(redeemed)
      setStatus("success")
    },
    [enabled, engine]
  )

  const reset = React.useCallback(() => {
    setStatus("idle")
    setError(null)
    setResult(null)
  }, [])

  return {
    status,
    error,
    errorMessage: error ? describeRedeemError(error) : null,
    result,
    redeem,
    reset,
  }
}
