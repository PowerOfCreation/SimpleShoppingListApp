import { Text, type TextProps, StyleSheet } from "react-native"
import React from "react"

import { useThemeColor } from "@/hooks/useThemeColor"

export type ThemedTextProps = TextProps & {
  lightColor?: string
  darkColor?: string
  type?: "default" | "title" | "defaultSemiBold" | "subtitle" | "link"
}

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "default",
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, "text")

  const getTypeStyle = (selectedType: string) => {
    switch (selectedType) {
      case "title":
        return styles.title
      case "defaultSemiBold":
        return styles.defaultSemiBold
      case "subtitle":
        return styles.subtitle
      case "link":
        return styles.link
      default:
        return styles.default
    }
  }

  return <Text style={[{ color }, getTypeStyle(type), style]} {...rest} />
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
    color: "#0a7ea4",
  },
})
