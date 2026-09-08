import type { getListSyncStatus } from "@/api/sync/list-sync-status"

export function listSyncPresentation(
  status: ReturnType<typeof getListSyncStatus>,
  enabled: boolean
) {
  if (status === "forbidden") {
    return {
      label: "No permission to sync",
      icon: "lock",
      tone: "danger",
      // Never actually shown: ListSyncStatusIndicator renders
      // ListSyncPermissionIndicator's fuller explanation for this status
      // instead. Kept here so every branch has the same shape.
      message: "You do not have permission to sync this list.",
    } as const
  }
  if (status === "error") {
    return {
      label: enabled ? "Sync failed" : "Sync failed · Sync disabled",
      icon: "error",
      tone: "danger",
      message: enabled
        ? "This list could not be synchronized. Please check your connection and try again. You can keep using it on this device."
        : "Sync failed and is disabled for this list. You can keep using it on this device. Enable Sync with account from the list menu to try again.",
    } as const
  }
  if (!enabled)
    return {
      label: "Private",
      icon: "cloud-off",
      tone: "textSecondary",
      message:
        "This list is stored on this device and sync is disabled. Enable Sync with account from the list menu to synchronize it with the cloud.",
    } as const
  if (status === "syncing")
    return {
      label: "Syncing…",
      icon: "sync",
      tone: "accent",
      message: "This list is currently synchronizing with the cloud.",
    } as const
  if (status === "synced")
    return {
      label: "Synced",
      icon: "cloud-done",
      tone: "accent",
      message:
        "The latest sync operation for this list completed successfully.",
    } as const
  return {
    label: "Sync enabled",
    icon: "cloud",
    tone: "accent",
    message:
      "Cloud sync is enabled for this list. A successful sync has not yet been confirmed in this app session.",
  } as const
}
