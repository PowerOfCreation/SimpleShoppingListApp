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
  return (
    <SyncStatusPopup
      explanation={{ title: presentation.label, message: presentation.message }}
    >
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
