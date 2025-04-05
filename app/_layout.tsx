import { useThemeColor } from "@/hooks/useThemeColor"
import { Stack } from "expo-router"
import { useColorScheme } from "react-native"
import React, { useEffect, useState } from "react"
import { initializeWithoutMigration } from "@/database/data-migration"
import { Text, View, ActivityIndicator, StyleSheet } from "react-native"

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
      <View style={styles.container}>
        <Text style={[styles.errorText, { color }]}>{error}</Text>
      </View>
    )
  }

  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={color} />
        <Text style={[styles.loadingText, { color }]}>
          Initializing database...
        </Text>
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
          headerTitle: "Shopping List",
          headerBackVisible: false,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    textAlign: "center",
    margin: 20,
  },
  loadingText: {
    marginTop: 20,
  },
})
