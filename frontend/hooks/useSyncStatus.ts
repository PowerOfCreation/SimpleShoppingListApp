import { useSyncExternalStore } from "react"
import { useNetworkState } from "expo-network"

import {
  getSyncStatus,
  onSyncStatusChanged,
  SyncStatus,
} from "@/api/sync/sync-status"

export function useSyncStatus(): SyncStatus | "offline" {
  const status = useSyncExternalStore(onSyncStatusChanged, getSyncStatus)
  const network = useNetworkState()

  // Unknown connectivity is not evidence that the device is offline.
  // Keep the engine's last result intact so reconnecting alone cannot
  // turn a failed sync into a successful one.
  if (network.isConnected === false || network.isInternetReachable === false) {
    return "offline"
  }
  return status
}
