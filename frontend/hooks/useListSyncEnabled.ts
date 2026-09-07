import { useEffect, useState } from "react"
import { getDatabase } from "@/database/database"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { onSyncListsChanged } from "@/api/sync/sync-events"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("useListSyncEnabled")

export function useListSyncEnabled(listId: string) {
  const [setting, setSetting] = useState({ listId, enabled: false })
  useEffect(() => {
    let version = 0
    const load = async () => {
      const current = ++version
      if (!listId) return
      try {
        const result = await new ListSyncSettingsRepository(
          getDatabase()
        ).isEnabled(listId)
        if (current === version && result.success) {
          setSetting({ listId, enabled: result.getValue()! })
        }
      } catch (error) {
        logger.warn("Could not load list sync setting", error)
      }
    }
    const unsubscribe = onSyncListsChanged(() => {
      void load()
    })
    void load()
    return () => {
      version++
      unsubscribe()
    }
  }, [listId])
  return setting.listId === listId && setting.enabled
}
