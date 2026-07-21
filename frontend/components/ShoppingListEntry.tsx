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
import { MaterialIcons } from "@expo/vector-icons"
import { Palette } from "@/constants/Colors"
import { useThemeColor } from "@/hooks/useThemeColor"

export type ShoppingListEntryProps = {
  id: string
  listName: string
  createdAt: number
  totalCount?: number
  completedCount?: number
  onPress: (event: GestureResponderEvent) => void
  onLongPress: (event: GestureResponderEvent) => void
  onPressOut?: (event: GestureResponderEvent) => void
  isEdited: boolean
  onCancelEditing: () => void
  onSaveEditing: (text: string) => void
  onDelete?: () => void
}

export const ShoppingListEntry = forwardRef<TextInput, ShoppingListEntryProps>(
  function ShoppingListEntry(props: ShoppingListEntryProps, ref) {
    const [text, onChangeText] = React.useState(props.listName)

    const dividerColor = useThemeColor({}, "divider")
    const textSecondaryColor = useThemeColor({}, "textSecondary")
    const accentColor = useThemeColor({}, "accent")
    const amberColor = useThemeColor({}, "amber")

    React.useEffect(() => {
      onChangeText(props.listName)
    }, [props.isEdited, props.listName])

    const handleDeletePress = () => {
      const ingredientCount = props.totalCount ?? 0
      const ingredientText =
        ingredientCount === 1 ? "ingredient" : "ingredients"

      Alert.alert(
        "Delete Shopping List",
        `Do you really want to delete list "${props.listName}" with ${ingredientCount} ${ingredientText}?`,
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
      <TouchableOpacity
        testID={`shopping-list-entry-${props.id}`}
        style={[styles.listItem, { borderBottomColor: dividerColor }]}
        onPress={props.onPress}
        onLongPress={props.onLongPress}
        onPressOut={props.onPressOut}
      >
        {props.isEdited ? (
          <View style={styles.editContainer}>
            <ThemedTextInput
              testID={`shopping-list-input-${props.id}`}
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
              <MaterialIcons
                name="delete"
                size={20}
                color={Palette.destructive}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <>
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
                  style={[
                    styles.progressBar,
                    { backgroundColor: dividerColor },
                  ]}
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
          </>
        )}
      </TouchableOpacity>
    )
  }
)

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
  editContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButton: {
    padding: 4,
    justifyContent: "center",
    alignItems: "center",
  },
})
