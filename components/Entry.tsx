import {
  GestureResponderEvent,
  TouchableOpacity,
  StyleSheet,
} from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"

type EntryProps = {
  ingredientName: string
  isCompleted: boolean
  onToggleComplete: (event: GestureResponderEvent) => void
}

export function Entry(props: EntryProps) {
  const getBackgroundColor = () => {
    return props.isCompleted
      ? styles.completedBackground
      : styles.uncompletedBackground
  }

  const getTextStyles = () => {
    return props.isCompleted ? [styles.completedText] : [styles.defaultText]
  }

  return (
    <TouchableOpacity
      style={[getBackgroundColor(), styles.buttonStyle]}
      onPress={props.onToggleComplete}
    >
      <ThemedText
        style={[styles.baseText, getTextStyles()]}
        type="defaultSemiBold"
      >
        {props.ingredientName}
      </ThemedText>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  buttonStyle: {
    width: "100%",
    height: 60,
    justifyContent: "center",
    borderTopWidth: 1,
    borderBlockColor: "gray",
  },
  completedBackground: {
    backgroundColor: "#121212",
  },
  uncompletedBackground: {
    backgroundColor: "#2e2e2e",
  },
  baseText: {
    left: 50,
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
