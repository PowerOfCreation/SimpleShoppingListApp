import * as React from "react"

import { createLogger } from "@/api/common/logger"
import { sharingClient } from "@/api/sharing/sharing-client"
import { getDatabase } from "@/database/database"
import { IngredientListRepository } from "@/database/ingredient-list-repository"

const logger = createLogger("useSharedSyncedLists")

export type SharedSyncedList = { id: string; name: string }

/**
 * Warning shown before an action that stops this device syncing one or more
 * lists (sign-out, turning a list's sync off) - shared wording so both cases
 * read the same way. `scope` is what stops ("Signing out ...", "Turning off
 * sync ..."); `sharedListNames` are the ones people other than this device
 * can still use afterwards.
 */
export function sharedSyncWarning(
  scope: string,
  sharedListNames: string[]
): string {
  if (sharedListNames.length === 0) {
    return scope
  }
  const names = sharedListNames.map((name) => `"${name}"`).join(", ")
  const pronoun = sharedListNames.length === 1 ? "it" : "them"
  return (
    `${scope}\n\nYou're currently sharing ${names}. People who already have ` +
    `access can keep using ${pronoun} as before - you just won't see ` +
    `further changes on this device anymore.`
  )
}

/**
 * Synced lists other people can still use after this device stops syncing
 * them: ones the caller is a member of, and owned ones with an active invite
 * link. There is no member-count endpoint (see SharingClient.listMyLists),
 * so an owned list with no active invite counts as not shared even if
 * someone joined earlier and the link was later revoked.
 *
 * Pass `listId` to check a single list (e.g. before turning its sync off)
 * instead of every synced list (e.g. before sign-out).
 *
 * Returns `null` when the check itself couldn't complete (DB or network
 * failure) - callers must treat that the same as "sharing can't be ruled
 * out", not as "nothing is shared", since this result gates whether a
 * confirmation is shown at all before stopping sync.
 */
export function useSharedSyncedLists() {
  const [isLoading, setIsLoading] = React.useState(false)

  const load = React.useCallback(
    async (listId?: string): Promise<SharedSyncedList[] | null> => {
      setIsLoading(true)
      try {
        const listRepository = new IngredientListRepository(getDatabase())
        const listsResult = await listRepository.getAll()
        if (!listsResult.success) {
          return null
        }
        const allSyncedLists = listsResult
          .getValue()!
          .filter((l) => l.syncEnabled)
        const syncedLists = listId
          ? allSyncedLists.filter((l) => l.id === listId)
          : allSyncedLists
        if (syncedLists.length === 0) {
          return []
        }

        const myListsResult = await sharingClient.listMyLists()
        if (!myListsResult.success) {
          return null
        }
        const roleById = new Map(
          myListsResult.getValue()!.map((m) => [m.listId, m.role])
        )

        const checked = await Promise.all(
          syncedLists.map(async (list) => {
            const role = roleById.get(list.id)
            if (role === "member") {
              return { id: list.id, name: list.name }
            }
            if (role === "owner") {
              const invitesResult = await sharingClient.getInvites(list.id)
              if (
                invitesResult.success &&
                invitesResult.getValue()!.length > 0
              ) {
                return { id: list.id, name: list.name }
              }
            }
            return null
          })
        )
        return checked.filter((list): list is SharedSyncedList => list !== null)
      } catch (err) {
        logger.warn("Could not determine currently shared lists", err)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return { load, isLoading }
}
