import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"
import Feather from "@expo/vector-icons/Feather"
import { ThemedTextInput } from "./ThemedTextInput"

type EntryProps = {
  ingredientName: string
  isCompleted: boolean
  onToggleComplete: (event: GestureResponderEvent) => void
  onLongPress: (event: GestureResponderEvent) => void
  isEdited: boolean
  onCancelEditing: () => void
  onSaveEditing: (text: string) => void
}

export function Entry(props: EntryProps) {
  const [text, onChangeText] = React.useState(props.ingredientName)

  const getBackgroundColor = () => {
    return props.isCompleted
      ? styles.completedBackground
      : styles.uncompletedBackground
  }

  const getTextStyles = () => {
    return props.isCompleted ? [styles.completedText] : [styles.defaultText]
  }

  React.useEffect(() => {
    onChangeText(props.ingredientName)
  }, [props.isEdited, props.ingredientName])

  return (
    <TouchableOpacity
      style={[getBackgroundColor(), styles.buttonStyle]}
      onPress={props.onToggleComplete}
      onLongPress={props.onLongPress}
    >
      <Feather
        name={props.isCompleted ? "check-circle" : "circle"}
        size={26}
        color="#1999b3"
      />

      {props.isEdited ? (
        <ThemedTextInput
          onChangeText={onChangeText}
          onSubmit={props.onSaveEditing}
          value={text}
          placeholder={""}
          autoFocus={true}
          onBlur={props.onCancelEditing}
        />
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
}

const styles = StyleSheet.create({
  buttonStyle: {
    paddingLeft: 15,
    width: "100%",
    height: 60,
    borderTopWidth: 1,
    borderBlockColor: "gray",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  },
  completedBackground: {
    backgroundColor: "#121212",
  },
  uncompletedBackground: {
    backgroundColor: "#2e2e2e",
  },
  baseText: {
    left: 20,
    flex: 1,
  },
  completedText: {
    color: "#00400b",
    textDecorationLine: "line-through",
  },
  defaultText: {
    color: "white",
    textDecorationLine: "none",
  },
})
