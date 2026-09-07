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
    } as const
  }
  if (status === "error") {
    return {
      label: enabled ? "Sync failed" : "Sync failed · Sync disabled",
      icon: "error",
      tone: "danger",
    } as const
  }
  if (!enabled)
    return {
      label: "Private",
      icon: "cloud-off",
      tone: "textSecondary",
    } as const
  if (status === "syncing")
    return { label: "Syncing…", icon: "sync", tone: "accent" } as const
  if (status === "synced")
    return { label: "Synced", icon: "cloud-done", tone: "accent" } as const
  return { label: "Sync enabled", icon: "cloud", tone: "accent" } as const
}
