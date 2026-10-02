import { useEffect, useSyncExternalStore } from "react"
import {
  getListSyncRejection,
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

export function useListSyncRejection(listId: string) {
  return useSyncExternalStore(onListSyncStatusChanged, () =>
    getListSyncRejection(listId)
  )
}
