import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  View,
  Alert,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React, { forwardRef } from "react"
import { ThemedTextInput } from "./ThemedTextInput"
import { ContextMenu } from "./ContextMenu"
import { MaterialIcons } from "@expo/vector-icons"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Palette } from "@/constants/Colors"
import { Priority } from "@/types/Priority"
import { formatPriority, priorityColorKey } from "@/utils/priority"

export type EntryProps = {
  id: string
  ingredientName: string
  isCompleted: boolean
  priority?: Priority
  onToggleComplete: (event: GestureResponderEvent) => void
  onRename: () => void
  onPressOut?: (event: GestureResponderEvent) => void
  isEdited: boolean
  onCancelEditing: () => void
  onSaveEditing: (text: string) => void
  onDelete?: () => void
}

export const Entry = forwardRef<TextInput, EntryProps>(function Entry(
  props: EntryProps,
  ref
) {
  const [text, onChangeText] = React.useState(props.ingredientName)
  const [showContextMenu, setShowContextMenu] = React.useState(false)

  const dividerColor = useThemeColor({}, "divider")
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")
  const textColor = useThemeColor({}, "text")
  const textSecondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")
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

  React.useEffect(() => {
    onChangeText(props.ingredientName)
  }, [props.isEdited, props.ingredientName])

  const handleDeletePress = () => {
    Alert.alert(
      "Delete Ingredient",
      `Do you really want to delete "${props.ingredientName}"?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            if (props.onDelete) {
              props.onDelete()
            }
          },
        },
      ]
    )
  }

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

        {props.isEdited ? (
          <View style={styles.editContainer}>
            <ThemedTextInput
              testID={`entry-input-${props.id}`}
              onChangeText={onChangeText}
              onSubmit={() => props.onSaveEditing(text)}
              value={text}
              placeholder={""}
              autoFocus={true}
              ref={ref}
            />
            <TouchableOpacity
              testID={`save-button-${props.id}`}
              style={styles.actionButton}
              onPress={() => props.onSaveEditing(text)}
            >
              <MaterialIcons name="check" size={20} color={Palette.success} />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`cancel-button-${props.id}`}
              style={styles.actionButton}
              onPress={props.onCancelEditing}
            >
              <MaterialIcons name="close" size={20} color={Palette.neutral} />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`delete-button-${props.id}`}
              style={styles.actionButton}
              onPress={handleDeletePress}
            >
              <MaterialIcons name="delete" size={20} color={dangerColor} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ThemedText
              style={[styles.baseText, getTextStyles()]}
              type="default"
            >
              {props.ingredientName}
            </ThemedText>
            {showPriorityBadge && (
              <View
                style={[
                  styles.priorityBadge,
                  { backgroundColor: priorityColor },
                ]}
              >
                <ThemedText
                  style={[styles.priorityBadgeText, { color: onAccentColor }]}
                >
                  {formatPriority(props.priority!)}
                </ThemedText>
              </View>
            )}
          </>
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
            onPress: props.onRename,
          },
          {
            label: "Delete",
            testID: `entry-context-delete-${props.id}`,
            destructive: true,
            onPress: handleDeletePress,
          },
        ]}
      />
    </>
  )
})

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
  editContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  actionButton: {
    padding: 4,
    justifyContent: "center",
    alignItems: "center",
  },
})
