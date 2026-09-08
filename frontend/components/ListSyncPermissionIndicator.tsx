import { MaterialIcons } from "@expo/vector-icons"
import { useListSyncStatus } from "@/hooks/useListSyncStatus"
import { useThemeColor } from "@/hooks/useThemeColor"
import { SyncStatusPopup } from "./SyncStatusPopup"

const explanation = {
  title: "No permission to sync",
  message:
    "You do not have permission to sync this list. The owner may have removed you, or you may be using a different account. You can keep using the list on this device, but your changes will not be shared and you will no longer receive changes from other members. To sync it as your own cloud list, you will need to duplicate it and sync the copy. Duplicating lists will be available in a future update.",
}

export function ListSyncPermissionIndicator({
  listId,
  size = 24,
}: {
  listId: string
  size?: number
}) {
  const status = useListSyncStatus(listId)
  const danger = useThemeColor({}, "danger")
  if (status !== "forbidden") return null
  return (
    <SyncStatusPopup explanation={explanation}>
      <MaterialIcons
        testID={`shopping-list-sync-icon-${listId}`}
        accessibilityLabel={explanation.title}
        name="lock"
        size={size}
        color={danger}
      />
    </SyncStatusPopup>
  )
}
