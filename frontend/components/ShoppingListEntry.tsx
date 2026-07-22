import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
  View,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"
import { ContextMenu } from "./ContextMenu"
import { RenameSheet } from "./RenameSheet"
import { ConfirmDialog } from "./ConfirmDialog"
import { useThemeColor } from "@/hooks/useThemeColor"

export type ShoppingListEntryProps = {
  id: string
  listName: string
  createdAt: number
  totalCount?: number
  completedCount?: number
  onPress: (event: GestureResponderEvent) => void
  onRename: (newName: string) => void
  onPressOut?: (event: GestureResponderEvent) => void
  onDelete?: () => void
}

export function ShoppingListEntry(props: ShoppingListEntryProps) {
  const [showContextMenu, setShowContextMenu] = React.useState(false)
  const [showRenameSheet, setShowRenameSheet] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  const dividerColor = useThemeColor({}, "divider")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const accentColor = useThemeColor({}, "accent")
  const amberColor = useThemeColor({}, "amber")

  const ingredientCount = props.totalCount ?? 0
  const ingredientText = ingredientCount === 1 ? "ingredient" : "ingredients"

  return (
    <>
      <TouchableOpacity
        testID={`shopping-list-entry-${props.id}`}
        style={[styles.listItem, { borderBottomColor: dividerColor }]}
        onPress={props.onPress}
        onLongPress={() => setShowContextMenu(true)}
        onPressOut={props.onPressOut}
      >
        <View style={styles.listContent}>
          <View style={styles.listInfo}>
            <ThemedText type="defaultSemiBold">{props.listName}</ThemedText>
            <ThemedText
              style={[styles.listDate, { color: textSecondaryColor }]}
              type="default"
            >
              {new Date(props.createdAt).toLocaleDateString()}
            </ThemedText>
          </View>
          {props.totalCount !== undefined &&
            props.completedCount !== undefined && (
              <ThemedText
                style={[styles.listCount, { color: textSecondaryColor }]}
                type="default"
              >
                {props.completedCount}/{props.totalCount}
              </ThemedText>
            )}
        </View>
        {props.totalCount !== undefined &&
          props.completedCount !== undefined &&
          props.totalCount > 0 && (
            <View
              style={[styles.progressBar, { backgroundColor: dividerColor }]}
            >
              <View
                style={{
                  flex: props.completedCount,
                  backgroundColor: accentColor,
                }}
              />
              <View
                style={{
                  flex: props.totalCount - props.completedCount,
                  backgroundColor: amberColor,
                }}
              />
            </View>
          )}
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
            label: "Delete",
            testID: `shopping-list-context-delete-${props.id}`,
            destructive: true,
            onPress: () => setShowDeleteConfirm(true),
          },
        ]}
      />
      <RenameSheet
        testID={`shopping-list-rename-sheet-${props.id}`}
        visible={showRenameSheet}
        initialValue={props.listName}
        onClose={() => setShowRenameSheet(false)}
        onSave={props.onRename}
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  listContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  listInfo: {
    flex: 1,
  },
  listDate: {
    fontSize: 12,
    marginTop: 2,
  },
  listCount: {
    fontSize: 13,
    marginLeft: 12,
  },
  progressBar: {
    flexDirection: "row",
    height: 8,
    marginTop: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
})
