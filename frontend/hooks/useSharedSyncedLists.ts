import * as React from "react"

import { createLogger } from "@/api/common/logger"
import { sharingClient } from "@/api/sharing/sharing-client"
import { getDatabase } from "@/database/database"
import { IngredientListRepository } from "@/database/ingredient-list-repository"

const logger = createLogger("useSharedSyncedLists")

export type SharedSyncedList = { id: string; name: string }

/**
 * Synced lists other people can still use after this device signs out: ones
 * the caller is a member of, and owned ones with an active invite link.
 * There is no member-count endpoint (see SharingClient.listMyLists), so an
 * owned list with no active invite counts as not shared even if someone
 * joined earlier and the link was later revoked.
 */
export function useSharedSyncedLists() {
  const [isLoading, setIsLoading] = React.useState(false)

  const load = React.useCallback(async (): Promise<SharedSyncedList[]> => {
    setIsLoading(true)
    try {
      const listRepository = new IngredientListRepository(getDatabase())
      const listsResult = await listRepository.getAll()
      if (!listsResult.success) {
        return []
      }
      const syncedLists = listsResult.getValue()!.filter((l) => l.syncEnabled)
      if (syncedLists.length === 0) {
        return []
      }

      const myListsResult = await sharingClient.listMyLists()
      if (!myListsResult.success) {
        return []
      }
      const roleById = new Map(
        myListsResult.getValue()!.map((m) => [m.listId, m.role])
      )

      const shared: SharedSyncedList[] = []
      for (const list of syncedLists) {
        const role = roleById.get(list.id)
        if (role === "member") {
          shared.push({ id: list.id, name: list.name })
        } else if (role === "owner") {
          const invitesResult = await sharingClient.getInvites(list.id)
          if (invitesResult.success && invitesResult.getValue()!.length > 0) {
            shared.push({ id: list.id, name: list.name })
          }
        }
      }
      return shared
    } catch (err) {
      logger.warn("Could not determine currently shared lists", err)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { load, isLoading }
}
