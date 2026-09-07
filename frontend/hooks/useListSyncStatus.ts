import { useEffect, useSyncExternalStore } from "react"
import {
  getListSyncStatus,
  loadListSyncPermission,
  onListSyncStatusChanged,
} from "@/api/sync/list-sync-status"

export function useListSyncStatus(listId: string) {
  useEffect(() => {
    void loadListSyncPermission(listId)
  }, [listId])
  return useSyncExternalStore(onListSyncStatusChanged, () =>
    getListSyncStatus(listId)
  )
}
