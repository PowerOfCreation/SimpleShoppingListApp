import React from "react"
import { Animated, StyleSheet } from "react-native"
import { ThemedText } from "./ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"

export type SystemMessageProps = {
  message: string | null
  onHide: () => void
  duration?: number
}

export function SystemMessage({
  message,
  onHide,
  duration = 1800,
}: SystemMessageProps) {
  const [opacity] = React.useState(() => new Animated.Value(0))
  const backgroundColor = useThemeColor({}, "text")
  const textColor = useThemeColor({}, "background")

  React.useEffect(() => {
    if (!message) return

    opacity.setValue(0)
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start()

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(onHide)
    }, duration)

    return () => clearTimeout(timer)
  }, [message, duration, opacity, onHide])

  if (!message) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { opacity, backgroundColor }]}
    >
      <ThemedText style={[styles.text, { color: textColor }]}>
        {message}
      </ThemedText>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 10,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
  },
})
