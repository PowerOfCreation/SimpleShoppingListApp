import { Switch, View, StyleSheet } from "react-native"
import type { StyleProp, ViewStyle } from "react-native"
import { ThemedText } from "./ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"

export type ToggleRowProps = {
  title: string
  subtitle?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  testID?: string
  accessibilityLabel?: string
  /** Outer container style - use this to control surrounding padding/borders. */
  style?: StyleProp<ViewStyle>
}

/**
 * A themed setting row: title (with optional subtitle) on the left, a Switch
 * on the right. Shared by the list-creation screen and the context menu so
 * every sync/setting toggle has the same look and behaviour.
 */
export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
  testID,
  accessibilityLabel,
  style,
}: ToggleRowProps) {
  const accentColor = useThemeColor({}, "accent")
  const dividerSubtleColor = useThemeColor({}, "dividerSubtle")
  const textSecondaryColor = useThemeColor({}, "textSecondary")

  return (
    <View style={[styles.row, style]}>
      <View style={styles.textContainer}>
        <ThemedText style={styles.title} type="defaultSemiBold">
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText style={[styles.subtitle, { color: textSecondaryColor }]}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? title}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: dividerSubtleColor, true: accentColor }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textContainer: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 14.5,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 11.5,
    marginTop: 2,
  },
})
