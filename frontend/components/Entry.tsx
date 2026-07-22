import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
  View,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"
import { ContextMenu } from "./ContextMenu"
import { PriorityPicker } from "./PriorityPicker"
import { RenameSheet } from "./RenameSheet"
import { ConfirmDialog } from "./ConfirmDialog"
import { MaterialIcons } from "@expo/vector-icons"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Priority } from "@/types/Priority"
import { formatPriority, priorityColorKey } from "@/utils/priority"

export type EntryProps = {
  id: string
  ingredientName: string
  isCompleted: boolean
  priority?: Priority
  onToggleComplete: (event: GestureResponderEvent) => void
  onRename: (newName: string) => void
  onPressOut?: (event: GestureResponderEvent) => void
  onDelete?: () => void
  onSetPriority?: (priority: Priority) => void
  onClearPriority?: () => void
}

export function Entry(props: EntryProps) {
  const [showContextMenu, setShowContextMenu] = React.useState(false)
  const [showPriorityPicker, setShowPriorityPicker] = React.useState(false)
  const [showRenameSheet, setShowRenameSheet] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  const dividerColor = useThemeColor({}, "divider")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const textColor = useThemeColor({}, "text")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const priorityColor = useThemeColor(
    {},
    props.priority !== undefined ? priorityColorKey(props.priority) : "accent"
  )

  const getTextStyles = () => {
    return props.isCompleted
      ? [styles.completedText, { color: textSecondaryColor }]
      : [styles.defaultText, { color: textColor }]
  }

  const showPriorityBadge = !props.isCompleted && props.priority !== undefined

  return (
    <>
      <TouchableOpacity
        testID={`entry-component-${props.id}`}
        style={[styles.buttonStyle, { borderBottomColor: dividerColor }]}
        onPress={props.onToggleComplete}
        onLongPress={() => setShowContextMenu(true)}
        onPressOut={props.onPressOut}
      >
        {props.isCompleted ? (
          <View style={[styles.checkbox, { backgroundColor: accentColor }]}>
            <MaterialIcons name="check" size={14} color={onAccentColor} />
          </View>
        ) : (
          <View style={[styles.checkbox, { borderColor: accentColor }]} />
        )}

        <ThemedText style={[styles.baseText, getTextStyles()]} type="default">
          {props.ingredientName}
        </ThemedText>
        {showPriorityBadge && (
          <View
            style={[styles.priorityBadge, { backgroundColor: priorityColor }]}
          >
            <ThemedText
              style={[styles.priorityBadgeText, { color: onAccentColor }]}
            >
              {formatPriority(props.priority!)}
            </ThemedText>
          </View>
        )}
      </TouchableOpacity>
      <ContextMenu
        testID={`entry-context-menu-${props.id}`}
        visible={showContextMenu}
        title={props.ingredientName}
        onClose={() => setShowContextMenu(false)}
        options={[
          {
            label: "Rename",
            testID: `entry-context-rename-${props.id}`,
            onPress: () => setShowRenameSheet(true),
          },
          {
            label: "Change priority",
            testID: `entry-context-priority-${props.id}`,
            onPress: () => setShowPriorityPicker(true),
          },
          {
            label: "Delete",
            testID: `entry-context-delete-${props.id}`,
            destructive: true,
            onPress: () => setShowDeleteConfirm(true),
          },
        ]}
      />
      <PriorityPicker
        testID={`entry-priority-picker-${props.id}`}
        visible={showPriorityPicker}
        title={props.ingredientName}
        currentPriority={props.priority}
        onClose={() => setShowPriorityPicker(false)}
        onApply={(priority) => {
          if (priority === undefined) {
            props.onClearPriority?.()
          } else {
            props.onSetPriority?.(priority)
          }
        }}
      />
      <RenameSheet
        testID={`entry-rename-sheet-${props.id}`}
        visible={showRenameSheet}
        initialValue={props.ingredientName}
        onClose={() => setShowRenameSheet(false)}
        onSave={props.onRename}
      />
      <ConfirmDialog
        testID={`entry-delete-confirm-${props.id}`}
        visible={showDeleteConfirm}
        title="Delete entry?"
        message={`"${props.ingredientName}" will be permanently removed from the list.`}
        confirmLabel="Delete"
        destructive
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => props.onDelete?.()}
      />
    </>
  )
}

const styles = StyleSheet.create({
  buttonStyle: {
    paddingHorizontal: 18,
    width: "100%",
    minHeight: 57,
    paddingVertical: 13,
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 2,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  baseText: {
    flex: 1,
    fontSize: 18,
  },
  completedText: {
    textDecorationLine: "line-through",
  },
  defaultText: {
    textDecorationLine: "none",
  },
  priorityBadge: {
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
    flexShrink: 0,
  },
  priorityBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
})
