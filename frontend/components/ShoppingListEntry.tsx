import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
  View,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"
import { ContextMenu } from "./ContextMenu"
import { TextInputSheet } from "./TextInputSheet"
import { ConfirmDialog } from "./ConfirmDialog"
import { useThemeColor } from "@/hooks/useThemeColor"
import { useListSyncStatus } from "@/hooks/useListSyncStatus"
import { ListSyncStatusIndicator } from "./ListSyncStatusIndicator"
import { listSyncPresentation } from "@/utils/listSyncPresentation"
import { MaterialIcons } from "@expo/vector-icons"

export type ShoppingListEntryProps = {
  id: string
  listName: string
  createdAt: number
  totalCount?: number
  completedCount?: number
  onPress: (event: GestureResponderEvent) => void
  onRename: (newName: string) => void
  onDuplicate?: (newName: string) => void
  onPressOut?: (event: GestureResponderEvent) => void
  onDelete?: () => void
  syncEnabled?: boolean
  onToggleSync?: (enabled: boolean) => void
  syncToggleDisabled?: boolean
  onResync?: () => void
  onShare?: () => void
}

export function ShoppingListEntry(props: ShoppingListEntryProps) {
  const [showContextMenu, setShowContextMenu] = React.useState(false)
  const [showRenameSheet, setShowRenameSheet] = React.useState(false)
  const [showDuplicateSheet, setShowDuplicateSheet] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const syncStatus = useListSyncStatus(props.id)
  const syncLabel = listSyncPresentation(
    syncStatus,
    props.syncEnabled ?? false
  ).label

  const ingredientCount = props.totalCount ?? 0
  const ingredientText = ingredientCount === 1 ? "ingredient" : "ingredients"
  const hasCounts =
    props.totalCount !== undefined && props.completedCount !== undefined
  const openCount = hasCounts ? props.totalCount! - props.completedCount! : 0

  return (
    <>
      <TouchableOpacity
        testID={`shopping-list-entry-${props.id}`}
        style={[styles.listItem, { borderBottomColor: dividerColor }]}
        onPress={props.onPress}
        onLongPress={() => setShowContextMenu(true)}
        onPressOut={props.onPressOut}
      >
        <MaterialIcons
          testID={`shopping-list-icon-${props.id}`}
          name="shopping-bag"
          size={44}
          color={textSecondaryColor}
          style={styles.listIcon}
        />
        <View style={styles.details}>
          <View style={styles.listContent}>
            <ThemedText
              type="defaultSemiBold"
              style={styles.listName}
              numberOfLines={1}
            >
              {props.listName}
            </ThemedText>
            {hasCounts && (
              <ThemedText style={styles.openCount}>{openCount} open</ThemedText>
            )}
            <MaterialIcons
              name="chevron-right"
              size={22}
              color={textSecondaryColor}
            />
          </View>
          <View style={styles.metaRow}>
            <ThemedText
              style={[styles.listDate, { color: textSecondaryColor }]}
              type="default"
            >
              {syncLabel}
              {" ·"} {ingredientCount}{" "}
              {ingredientCount === 1 ? "item" : "items"}
            </ThemedText>
            <ListSyncStatusIndicator
              listId={props.id}
              syncEnabled={props.syncEnabled ?? false}
              size={syncStatus === "forbidden" ? 18 : 14}
            />
          </View>
        </View>
      </TouchableOpacity>
      <ContextMenu
        testID={`shopping-list-context-menu-${props.id}`}
        visible={showContextMenu}
        title={props.listName}
        onClose={() => setShowContextMenu(false)}
        options={[
          {
            label: "Rename",
            testID: `shopping-list-context-rename-${props.id}`,
            onPress: () => setShowRenameSheet(true),
          },
          {
            label: "Duplicate",
            testID: `shopping-list-context-duplicate-${props.id}`,
            onPress: () => setShowDuplicateSheet(true),
          },
          {
            type: "toggle",
            label: "Sync with account",
            testID: `shopping-list-context-sync-${props.id}`,
            value: props.syncEnabled ?? false,
            disabled: props.syncToggleDisabled,
            onValueChange: (enabled) => props.onToggleSync?.(enabled),
          },
          // Only meaningful once sync is actually on for this list and sync
          // interactions aren't disabled (e.g. signed out) - otherwise
          // there's nothing to re-derive from the server, or no valid
          // session to do it with. Inviting has the same precondition for a
          // sharper reason: only a list the server holds a log for can be
          // shared at all (see frontend/docs/sync-sharing-target.md 4.2),
          // and the server only learns of one through a push.
          ...(props.syncEnabled && !props.syncToggleDisabled
            ? [
                {
                  label: "Invite people",
                  testID: `shopping-list-context-share-${props.id}`,
                  onPress: () => props.onShare?.(),
                },
                {
                  label: "Re-sync from server",
                  testID: `shopping-list-context-resync-${props.id}`,
                  onPress: () => props.onResync?.(),
                },
              ]
            : []),
          {
            label: "Delete",
            testID: `shopping-list-context-delete-${props.id}`,
            destructive: true,
            onPress: () => setShowDeleteConfirm(true),
          },
        ]}
      />
      <TextInputSheet
        testID={`shopping-list-rename-sheet-${props.id}`}
        visible={showRenameSheet}
        initialValue={props.listName}
        onClose={() => setShowRenameSheet(false)}
        onSave={props.onRename}
      />
      <TextInputSheet
        testID={`shopping-list-duplicate-sheet-${props.id}`}
        title="Duplicate list"
        visible={showDuplicateSheet}
        initialValue={`${props.listName} (Copy)`}
        onClose={() => setShowDuplicateSheet(false)}
        onSave={(newName) => props.onDuplicate?.(newName)}
      />
      <ConfirmDialog
        testID={`shopping-list-delete-confirm-${props.id}`}
        visible={showDeleteConfirm}
        title="Delete list?"
        message={`"${props.listName}" and its ${ingredientCount} ${ingredientText} will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => props.onDelete?.()}
      />
    </>
  )
}

const styles = StyleSheet.create({
  listItem: {
    paddingHorizontal: 0,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
  },
  listContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listName: {
    flex: 1,
    fontSize: 19,
    marginRight: 8,
  },
  details: { flex: 1 },
  listIcon: { marginRight: 14 },
  openCount: { fontSize: 16, marginRight: 10 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  listDate: {
    fontSize: 15,
  },
})
