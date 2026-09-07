import { useSyncExternalStore } from "react"

import {
  getSyncStatus,
  onSyncStatusChanged,
  SyncStatus,
} from "@/api/sync/sync-status"

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(onSyncStatusChanged, getSyncStatus)
}
