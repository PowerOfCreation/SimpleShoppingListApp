import { useThemeColor } from "@/hooks/useThemeColor"
import { Stack } from "expo-router"
import { useColorScheme } from "react-native"
import React, { useEffect, useState } from "react"
import { initializeWithoutMigration } from "@/database/data-migration"
import { Text, View, ActivityIndicator } from "react-native"

export default function RootLayout() {
  useColorScheme()
  const color = useThemeColor({}, "text")
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backgroundColor = useThemeColor({}, "background")

  useEffect(() => {
    async function initializeDatabase() {
      try {
        await initializeWithoutMigration()
        setIsInitialized(true)
      } catch (err) {
        console.error("Failed to initialize database:", err)
        setError(`Database initialization failed: ${err}`)
      }
    }

    initializeDatabase()
  }, [])

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor,
        }}
      >
        <Text style={{ color, textAlign: "center", margin: 20 }}>{error}</Text>
      </View>
    )
  }

  if (!isInitialized) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor,
        }}
      >
        <ActivityIndicator size="large" color={color} />
        <Text style={{ color, marginTop: 20 }}>Initializing database...</Text>
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor },
        headerTintColor: color,
        headerStyle: {
          backgroundColor,
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
