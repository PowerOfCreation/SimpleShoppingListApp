import React from "react"

import { createLogger } from "@/api/common/logger"
import { getDatabase } from "@/database/database"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { sharingClient } from "@/api/sharing/sharing-client"
import { notifySyncListsChanged } from "@/api/sync/sync-events"
import { useSyncEngine } from "@/api/sync/SyncProvider"
import { describeSharingError } from "@/hooks/useListInvites"

const logger = createLogger("useRedeemInvite")

export type RedeemStatus =
  | "idle"
  | "working"
  /** Joined and the list's content is already on this device. */
  | "joined"
  /**
   * Joined server-side, but the initial pull didn't land the list's content
   * locally yet (offline, or a transient network failure). Not an error -
   * SyncCoordinator's own retries (reconnect, foreground, the periodic
   * safety interval) will finish this without any further action here.
   */
  | "pending"
  | "error"

/**
 * Drives redeeming an invite end to end: call the backend, then - unlike
 * turning sync on for a list the owner already has locally
 * (ShoppingListService.setSyncEnabled, which pushes existing history
 * outward) - a fresh join has no local content at all, so this goes the
 * other direction: enable the device-local sync setting for a listId this
 * device has never seen, then pull it from seq 0 so EventApplier rebuilds
 * the list (including its name, from the first todo_list.created) from the
 * server's full history (sync-sharing-target.md §4.3).
 */
export function useRedeemInvite() {
  const engine = useSyncEngine()
  const [status, setStatus] = React.useState<RedeemStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [listId, setListId] = React.useState<string | null>(null)
  const [alreadyMember, setAlreadyMember] = React.useState(false)

  const redeem = React.useCallback(
    async (token: string) => {
      setStatus("working")
      setErrorMessage(null)

      const redeemResult = await sharingClient.redeemInvite(token)
      if (!redeemResult.success) {
        const sharingError = redeemResult.getError()
        logger.warn("Could not redeem invite", sharingError)
        setErrorMessage(describeSharingError(sharingError))
        setStatus("error")
        return
      }

      const redeemed = redeemResult.getValue()!
      setListId(redeemed.listId)
      setAlreadyMember(redeemed.alreadyMember)

      try {
        const db = getDatabase()
        const listSyncSettingsRepository = new ListSyncSettingsRepository(db)
        const ingredientListRepository = new IngredientListRepository(db)

        const enableResult = await listSyncSettingsRepository.setEnabled(
          redeemed.listId,
          true
        )
        if (!enableResult.success) {
          logger.error(
            "Could not enable sync for the redeemed list",
            enableResult.getError()
          )
          // The join itself already succeeded server-side; only the local
          // setup failed. SyncCoordinator finds this the same way it finds
          // any other never-enabled list next time settings are read, so
          // this is a "not yet" rather than a failure to report.
          setStatus("pending")
          return
        }

        // Lets the running coordinator (if any) pick this list up over the
        // WebSocket immediately, independent of the direct pull below.
        notifySyncListsChanged()

        await engine.pullList(redeemed.listId)

        const localResult = await ingredientListRepository.getById(
          redeemed.listId
        )
        setStatus(
          localResult.success && localResult.getValue() ? "joined" : "pending"
        )
      } catch (error) {
        logger.error("Unexpected error finishing the join", error)
        setStatus("pending")
      }
    },
    [engine]
  )

  return { status, errorMessage, listId, alreadyMember, redeem }
}
