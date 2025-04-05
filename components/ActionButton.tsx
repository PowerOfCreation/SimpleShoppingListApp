import {
  GestureResponderEvent,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native"
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
      style={styles.button}
      onPress={props.onPress}
    >
      <Text style={styles.symbol}>{props.symbol}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
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
  },
  symbol: {
    fontSize: 48,
  },
})
