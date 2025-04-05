import { GestureResponderEvent, Text, TouchableOpacity } from "react-native"
import React from "react"

type ActionProps = {
  testID?: string
  symbol: string
  onPress: (event: GestureResponderEvent) => void
}

export function ActionButton(props: ActionProps) {
  return (
    <TouchableOpacity
      testID={props.testID}
      style={{
        borderWidth: 1,
        borderColor: "rgba(0,0,0,0.2)",
        alignItems: "center",
        justifyContent: "center",
        width: 70,
        position: "absolute",
        bottom: 10,
        right: 10,
        height: 70,
        backgroundColor: "#fff",
        borderRadius: 100,
      }}
      onPress={props.onPress}
    >
      <Text style={{ fontSize: 48 }}>{props.symbol}</Text>
    </TouchableOpacity>
  )
}
