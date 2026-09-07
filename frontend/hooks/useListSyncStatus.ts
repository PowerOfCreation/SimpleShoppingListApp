import { useSyncExternalStore } from "react"
import {
  getListSyncStatus,
  onListSyncStatusChanged,
} from "@/api/sync/list-sync-status"

export function useListSyncStatus(listId: string) {
  return useSyncExternalStore(onListSyncStatusChanged, () =>
    getListSyncStatus(listId)
  )
}
