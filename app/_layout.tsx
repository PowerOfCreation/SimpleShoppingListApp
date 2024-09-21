import { useThemeColor } from "@/hooks/useThemeColor"
import { Stack } from "expo-router"
import { useColorScheme } from "react-native"
import React from "react"

export default function RootLayout() {
  useColorScheme()
  const color = useThemeColor({}, "text")

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: useThemeColor({}, "background") },
        headerTintColor: color,
        headerStyle: {
          backgroundColor: useThemeColor({}, "background"),
        },
      }}
    >
      <Stack.Screen
        options={{
          // Hide the header for this route
          headerTitle: "Shopping List",
        }}
        name="index"
      />
      <Stack.Screen
        options={{
          headerTitle: "Add new ingredient",
          // Hide the header for this route
        }}
        name="new_ingredient"
      />
    </Stack>
  )
}
