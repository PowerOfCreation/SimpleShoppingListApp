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
        style={styles.listItem}
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
              <MaterialIcons name="check" size={20} color="#34C759" />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`cancel-button-${props.id}`}
              style={styles.actionButton}
              onPress={props.onCancelEditing}
            >
              <MaterialIcons name="close" size={20} color="#8E8E93" />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`delete-button-${props.id}`}
              style={styles.actionButton}
              onPress={handleDeletePress}
            >
              <MaterialIcons name="delete" size={20} color="#ff3b30" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.listContent}>
              <View style={styles.listInfo}>
                <ThemedText type="default">{props.listName}</ThemedText>
                <ThemedText style={styles.listDate} type="default">
                  {new Date(props.createdAt).toLocaleDateString()}
                </ThemedText>
              </View>
              {props.totalCount !== undefined &&
                props.completedCount !== undefined && (
                  <ThemedText style={styles.listCount} type="default">
                    {props.completedCount}/{props.totalCount}
                  </ThemedText>
                )}
            </View>
            {props.totalCount !== undefined &&
              props.completedCount !== undefined &&
              props.totalCount > 0 && (
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressCompleted,
                      {
                        flex: props.completedCount,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.progressIncomplete,
                      {
                        flex: props.totalCount - props.completedCount,
                      },
                    ]}
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
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  listContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listInfo: {
    flex: 1,
  },
  listDate: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.6,
  },
  listCount: {
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 12,
    opacity: 0.7,
  },
  progressBar: {
    flexDirection: "row",
    height: 4,
    marginTop: 8,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressCompleted: {
    backgroundColor: "#2196F3",
  },
  progressIncomplete: {
    backgroundColor: "#FF9800",
  },
  editContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: -12,
  },
  actionButton: {
    padding: 4,
    justifyContent: "center",
    alignItems: "center",
  },
})
