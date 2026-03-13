import { useThemeColor } from "@/hooks/useThemeColor"
import { Drawer } from "expo-router/drawer"
import { useColorScheme } from "react-native"
import React, { useEffect, useState } from "react"
import { Text, View, ActivityIndicator, StyleSheet } from "react-native"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { createLogger } from "@/api/common/logger"
import { getDatabase } from "@/database/database"
import { SafeAreaProvider } from "react-native-safe-area-context"

const logger = createLogger("RootLayout")

export default function RootLayout() {
  useColorScheme()
  const color = useThemeColor({}, "text")
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backgroundColor = useThemeColor({}, "background")

  useEffect(() => {
    async function initializeDatabase() {
      try {
        const db = getDatabase()
        const result = await initializeAndMigrateDatabase(db)

        if (result.success) {
          setIsInitialized(true)
        } else {
          const dbError = result.getError()
          logger.error("Failed to initialize database", dbError)
          setError(
            `Database initialization failed: ${dbError?.message || "Unknown error"}`
          )
        }
      } catch (err) {
        logger.error("Unexpected error initializing database", err)
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
    <SafeAreaProvider>
      <Drawer
        screenOptions={{
          drawerStyle: { backgroundColor },
          drawerLabelStyle: { color },
          headerStyle: { backgroundColor },
          headerTintColor: color,
          sceneStyle: { backgroundColor },
        }}
      >
        <Drawer.Screen
          name="index"
          options={{
            drawerLabel: "Shopping Lists",
            headerTitle: "Shopping Lists",
          }}
        />
        <Drawer.Screen
          name="view_shopping_list"
          options={{
            drawerLabel: "View Shopping List",
            headerTitle: "Shopping List",
            drawerItemStyle: { display: "none" },
          }}
        />
        <Drawer.Screen
          name="new_ingredient"
          options={{
            drawerLabel: "Add Ingredient",
            headerTitle: "Add new ingredient",
            drawerItemStyle: { display: "none" },
          }}
        />
        <Drawer.Screen
          name="new_shopping_list"
          options={{
            drawerLabel: "New Shopping List",
            headerTitle: "Create new shopping list",
            drawerItemStyle: { display: "none" },
          }}
        />
      </Drawer>
    </SafeAreaProvider>
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
