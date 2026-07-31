import React from "react"
import {
  ActivityIndicator,
  GestureResponderEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native"

import { useThemeColor } from "@/hooks/useThemeColor"

export type PrimaryButtonProps = {
  testID?: string
  label: string
  onPress: (event: GestureResponderEvent) => void
  variant?: "accent" | "danger"
  loading?: boolean
  disabled?: boolean
}

/**
 * Filled action button matching the confirm buttons used in the sheets.
 * `ActionButton` is the floating add button and is not interchangeable.
 */
export function PrimaryButton({
  testID,
  label,
  onPress,
  variant = "accent",
  loading = false,
  disabled = false,
}: PrimaryButtonProps) {
  const accentColor = useThemeColor({}, "accent")
  const dangerColor = useThemeColor({}, "danger")
  const onAccentColor = useThemeColor({}, "onAccent")

  const backgroundColor = variant === "danger" ? dangerColor : accentColor
  const isDisabled = disabled || loading

  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor },
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={onAccentColor} />
      ) : (
        <Text style={[styles.label, { color: onAccentColor }]}>{label}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 44,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
  },
})
