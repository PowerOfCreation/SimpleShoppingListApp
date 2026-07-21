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
import Feather from "@expo/vector-icons/Feather"
import { Palette } from "@/constants/Colors"
import { ThemedTextInput } from "./ThemedTextInput"
import { MaterialIcons } from "@expo/vector-icons"
import { useThemeColor } from "@/hooks/useThemeColor"

export type EntryProps = {
  id: string
  ingredientName: string
  isCompleted: boolean
  onToggleComplete: (event: GestureResponderEvent) => void
  onLongPress: (event: GestureResponderEvent) => void
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

  const dividerColor = useThemeColor({}, "divider")
  const cardSurfaceColor = useThemeColor({}, "cardSurface")
  const cardSurfaceCompletedColor = useThemeColor({}, "cardSurfaceCompleted")
  const completedItemTextColor = useThemeColor({}, "completedItemText")
  const defaultItemTextColor = useThemeColor({}, "defaultItemText")

  const getBackgroundColor = () => {
    return {
      backgroundColor: props.isCompleted
        ? cardSurfaceCompletedColor
        : cardSurfaceColor,
    }
  }

  const getTextStyles = () => {
    return props.isCompleted
      ? [styles.completedText, { color: completedItemTextColor }]
      : [styles.defaultText, { color: defaultItemTextColor }]
  }

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
    <TouchableOpacity
      testID={`entry-component-${props.id}`}
      style={[
        styles.buttonStyle,
        { borderBlockColor: dividerColor },
        getBackgroundColor(),
      ]}
      onPress={props.onToggleComplete}
      onLongPress={props.onLongPress}
      onPressOut={props.onPressOut}
    >
      <Feather
        name={props.isCompleted ? "check-circle" : "circle"}
        size={26}
        color={Palette.primary}
      />

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
            <MaterialIcons
              name="delete"
              size={20}
              color={Palette.destructive}
            />
          </TouchableOpacity>
        </View>
      ) : (
        <ThemedText
          style={[styles.baseText, getTextStyles()]}
          type="defaultSemiBold"
        >
          {props.ingredientName}
        </ThemedText>
      )}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  buttonStyle: {
    paddingLeft: 15,
    width: "100%",
    height: 60,
    borderTopWidth: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  },
  baseText: {
    left: 20,
    flex: 1,
  },
  completedText: {
    textDecorationLine: "line-through",
  },
  defaultText: {
    textDecorationLine: "none",
  },
  editContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: -4,
    flex: 1,
  },
  actionButton: {
    padding: 4,
    justifyContent: "center",
    alignItems: "center",
  },
})
