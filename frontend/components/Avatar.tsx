import React from "react"
import { Image, StyleProp, StyleSheet, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

// Fallback backdrop colors, picked by hashing `name` - purely for visual
// variety, never a security or identity signal. Same name -> same color on
// every device, no server state needed.
const FALLBACK_COLORS = [
  "#F87171",
  "#FB923C",
  "#FBBF24",
  "#4ADE80",
  "#22D3EE",
  "#818CF8",
  "#C084FC",
  "#F472B6",
]

function fallbackColor(seed: string | null): string {
  if (!seed) return FALLBACK_COLORS[0]
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length]
}

export type AvatarProps = {
  testID?: string
  uri?: string | null
  name?: string | null
  size?: number
  style?: StyleProp<ViewStyle>
}

/**
 * Picture avatar that falls back to a hash-colored circle with a person icon
 * when there's no `uri` (e.g. no profile picture set yet).
 */
export function Avatar({
  testID,
  uri,
  name = null,
  size = 72,
  style,
}: AvatarProps) {
  const dimensions = { width: size, height: size, borderRadius: size / 2 }

  if (uri) {
    return (
      <Image testID={testID} source={{ uri }} style={[dimensions, style]} />
    )
  }

  return (
    <View
      testID={testID ? `${testID}-fallback` : undefined}
      style={[
        dimensions,
        styles.fallback,
        { backgroundColor: fallbackColor(name) },
        style,
      ]}
    >
      <Ionicons name="person" size={size * 0.55} color="#fff" />
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: {
    justifyContent: "center",
    alignItems: "center",
  },
})
