import React, { createContext, useContext, useEffect, useMemo } from "react"

import { useAuth } from "@/api/auth/AuthProvider"
import { getDatabase } from "@/database/database"
import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { SyncClient } from "@/api/sync/sync-client"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncCoordinator } from "@/api/sync/sync-coordinator"
import { EventApplier } from "@/api/sync/event-applier"
import { isSyncConfigured } from "@/api/sync/config"

type SyncContextValue = {
  engine: SyncEngine
}

const SyncContext = createContext<SyncContextValue | null>(null)

/**
 * Wires the sync engine and its app-lifecycle triggers (see
 * SyncCoordinator) into the app. Must be mounted below AuthProvider (it
 * reads useAuth()) and only after the database has been initialized and
 * migrated - app/_layout.tsx already guarantees both by the time either
 * provider renders.
 *
 * None of this ever runs unless signed in and sync is configured
 * (EXPO_PUBLIC_API_URL set) - signed out or unconfigured, this provider
 * does nothing beyond holding the engine instance ready for when that
 * changes. The app keeps working purely offline either way.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()

  // Constructed once per app run; cheap (no I/O on construction), and safe
  // to build before knowing whether they'll ever be used.
  const engine = useMemo(() => {
    const db = getDatabase()
    const eventRepository = new EventRepository(db)
    const cursorRepository = new SyncCursorRepository(db)
    const eventApplier = new EventApplier(
      db,
      eventRepository,
      new IngredientProjection(db),
      new IngredientListProjection(db),
      cursorRepository,
      new ListSyncSettingsRepository(db)
    )
    return new SyncEngine(
      new OutboxRepository(db),
      eventRepository,
      new SyncClient(),
      cursorRepository,
      eventApplier,
      new ListSyncSettingsRepository(db)
    )
  }, [])

  const coordinator = useMemo(
    () =>
      new SyncCoordinator(
        engine,
        new ListSyncSettingsRepository(getDatabase())
      ),
    [engine]
  )

  useEffect(() => {
    if (status !== "signedIn" || !isSyncConfigured()) {
      coordinator.stop()
      return
    }

    coordinator.start()
    return () => coordinator.stop()
  }, [status, coordinator])

  const value = useMemo(() => ({ engine }), [engine])

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/**
 * Exposes the sync engine directly for callers that need it beyond what
 * this provider already wires up on its own.
 */
export function useSyncEngine(): SyncEngine {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error("useSyncEngine must be used within a SyncProvider")
  }
  return context.engine
}
