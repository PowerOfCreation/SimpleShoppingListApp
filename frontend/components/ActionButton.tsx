import {
  GestureResponderEvent,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native"
import React from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useThemeColor } from "@/hooks/useThemeColor"
import { Palette } from "@/constants/Colors"

type ActionProps = {
  testID?: string
  label?: string
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
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={[
        styles.button,
        props.label ? styles.labeledButton : undefined,
        { bottom: 24 + insets.bottom, backgroundColor: accentColor },
      ]}
      onPress={props.onPress}
    >
      <Text style={[styles.symbol, { color: onAccentColor }]}>
        {props.symbol}
      </Text>
      {props.label && (
        <Text style={[styles.label, { color: onAccentColor }]}>
          {props.label}
        </Text>
      )}
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
    shadowColor: Palette.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  labeledButton: {
    width: "auto",
    paddingHorizontal: 20,
    height: 56,
    borderRadius: 20,
    flexDirection: "row",
    gap: 12,
  },
  label: { fontSize: 18, fontWeight: "600" },
  symbol: {
    fontSize: 24,
    lineHeight: 26,
  },
})
