import { MaterialIcons } from "@expo/vector-icons"
import { useListSyncStatus } from "@/hooks/useListSyncStatus"
import { useThemeColor } from "@/hooks/useThemeColor"
import { listSyncPresentation } from "@/utils/listSyncPresentation"
import { SyncStatusPopup } from "./SyncStatusPopup"
import { ListSyncPermissionIndicator } from "./ListSyncPermissionIndicator"

export function ListSyncStatusIndicator({
  listId,
  syncEnabled,
  size = 24,
}: {
  listId: string
  syncEnabled: boolean
  size?: number
}) {
  const status = useListSyncStatus(listId)
  const presentation = listSyncPresentation(status, syncEnabled)
  const color = useThemeColor({}, presentation.tone)
  if (status === "forbidden") {
    return <ListSyncPermissionIndicator listId={listId} size={size} />
  }
  const message =
    status === "error"
      ? syncEnabled
        ? "This list could not be synchronized. Please check your connection and try again. You can keep using it on this device."
        : "Sync failed and is disabled for this list. You can keep using it on this device. Enable Sync with account from the list menu to try again."
      : !syncEnabled
        ? "This list is stored on this device and sync is disabled. Enable Sync with account from the list menu to synchronize it with the cloud."
        : status === "syncing"
          ? "This list is currently synchronizing with the cloud."
          : status === "synced"
            ? "The latest sync operation for this list completed successfully."
            : "Cloud sync is enabled for this list. A successful sync has not yet been confirmed in this app session."
  return (
    <SyncStatusPopup explanation={{ title: presentation.label, message }}>
      <MaterialIcons
        testID={`shopping-list-sync-icon-${listId}`}
        accessibilityLabel={presentation.label}
        name={presentation.icon}
        size={size}
        color={color}
      />
    </SyncStatusPopup>
  )
}
