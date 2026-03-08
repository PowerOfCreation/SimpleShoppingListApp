/**
 * Custom hook for managing database lifecycle events.
 * Resets the database connection when the app moves to the background.
 * This helps avoid connection stale issues and lock contention on app restore.
 */

import { useEffect } from "react"
import { AppState, AppStateStatus } from "react-native"
import { resetDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useDatabaseLifecycle")

export function useDatabaseLifecycle() {
  useEffect(() => {
    // Subscribe to app state changes
    const subscription = AppState.addEventListener("change", handleAppStateChange)

    return () => {
      // Clean up the subscription on unmount
      subscription.remove()
    }
  }, [])

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === "background") {
      // App is moving to background - reset database connection
      logger.info(
        "App moving to background, resetting database connection to avoid stale connections"
      )
      resetDatabase()
    }
  }
}
