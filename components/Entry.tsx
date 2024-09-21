import { GestureResponderEvent, TouchableOpacity } from "react-native"
import { ThemedText } from "./ThemedText"
import React from "react"

type EntryProps = {
  ingredientName: string
  isCompleted: boolean
  onToggleComplete: (event: GestureResponderEvent) => void
}

export function Entry(props: EntryProps) {
  return (
    <TouchableOpacity
      style={{
        width: "100%",
        backgroundColor: props.isCompleted ? "#121212" : "#2e2e2e",
        height: 60,
        justifyContent: "center",
        borderTopWidth: 1,
        borderBlockColor: "gray",
      }}
      onPress={props.onToggleComplete}
    >
      <ThemedText
        style={{
          left: 50,
          color: props.isCompleted ? "#00400b" : "white",
          textDecorationLine: props.isCompleted ? "line-through" : "none",
        }}
        type="defaultSemiBold"
      >
        {props.ingredientName}
      </ThemedText>
    </TouchableOpacity>
  )
}
