import {
  GestureResponderEvent,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native"
import React from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useThemeColor } from "@/hooks/useThemeColor"

type ActionProps = {
  testID?: string
  symbol: string
  onPress: (event: GestureResponderEvent) => void
}

export function ActionButton(props: ActionProps) {
  const insets = useSafeAreaInsets()
  const accentColor = useThemeColor({}, "accent")
  const onAccentColor = useThemeColor({}, "onAccent")

  return (
    <TouchableOpacity
      testID={props.testID}
      style={[
        styles.button,
        { bottom: 24 + insets.bottom, backgroundColor: accentColor },
      ]}
      onPress={props.onPress}
    >
      <Text style={[styles.symbol, { color: onAccentColor }]}>
        {props.symbol}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    width: 55,
    height: 55,
    position: "absolute",
    right: 24,
    borderRadius: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  symbol: {
    fontSize: 24,
    lineHeight: 26,
  },
})
