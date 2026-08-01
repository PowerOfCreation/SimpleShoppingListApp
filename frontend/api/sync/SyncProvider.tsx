import React, { createContext, useContext, useEffect, useMemo } from "react"
import { AppState, AppStateStatus } from "react-native"

import { useAuth } from "@/api/auth/AuthProvider"
import { getDatabase } from "@/database/database"
import { OutboxRepository } from "@/database/outbox-repository"
import { EventRepository } from "@/database/event-repository"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { SyncCursorRepository } from "@/database/sync-cursor-repository"
import { SyncClient } from "@/api/sync/sync-client"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncSocket } from "@/api/sync/sync-socket"
import { EventApplier } from "@/api/sync/event-applier"
import { isSyncConfigured } from "@/api/sync/config"
import { onOutboxChanged } from "@/api/sync/outbox-events"
import { onSyncListsChanged } from "@/api/sync/sync-events"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("SyncProvider")

// A fallback net for pull and reconcile, not the primary mechanism - the
// primary triggers are the WebSocket (re)connecting, the app coming to the
// foreground, and (for push) right after a flush. This just guarantees a
// pull + self-heal pass happens periodically even if the app sits open,
// connected, and idle for a long time.
const RECONCILE_SAFETY_INTERVAL_MS = 5 * 60 * 1000

// Coalesces a burst of "new event" notifications for the same list (e.g.
// several quick edits) into one pull, and gives an echo of our own
// just-pushed events a moment to resolve as a harmless no-op (the applier
// is idempotent either way, but there's no reason to pull mid-burst).
const LIST_EVENT_DEBOUNCE_MS = 400

type SyncContextValue = {
  engine: SyncEngine
}

const SyncContext = createContext<SyncContextValue | null>(null)

/**
 * Wires the sync engine, the outbox flush, and the ack/reconcile WebSocket
 * into the app lifecycle. Must be mounted below AuthProvider (it reads
 * useAuth()) and only after the database has been initialized and
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
      cursorRepository
    )
    return new SyncEngine(
      new OutboxRepository(db),
      eventRepository,
      new SyncClient(),
      cursorRepository,
      eventApplier
    )
  }, [])

  const listRepository = useMemo(
    () => new IngredientListRepository(getDatabase()),
    []
  )

  async function reconcileNow(): Promise<void> {
    const idsResult = await listRepository.getSyncEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Reconcile: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    await engine.reconcile(idsResult.getValue()!)
  }

  async function pullNow(): Promise<void> {
    const idsResult = await listRepository.getSyncEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Pull: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    await engine.pull(idsResult.getValue()!)
  }

  async function subscribeNow(): Promise<void> {
    const idsResult = await listRepository.getSyncEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Subscribe: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    socket.subscribe(idsResult.getValue()!)
  }

  // engine and listRepository are stable (memoized with no deps), so this
  // closure behaves identically across renders even though it isn't
  // memoized itself.
  const socket = useMemo(() => {
    // Debounce state lives here, closed over by the onListEvent callback -
    // scoped to this one SyncSocket instance's lifetime, same as the
    // socket itself.
    const pendingPulls = new Map<string, ReturnType<typeof setTimeout>>()

    return new SyncSocket(
      (eventId) => {
        engine.handleAck(eventId).catch((error) => {
          logger.error("Failed to handle ack", error)
        })
      },
      () => {
        // Freshly (re)connected is exactly the moment a gap that opened
        // up while disconnected should be caught - both directions:
        // pull anything the server got that we don't have yet, and
        // reconcile (self-heal) anything we sent that never got acked.
        // The socket itself already resent our subscriptions from its own
        // onopen, before this fires.
        pullNow().catch((error) => {
          logger.error("Pull on connect failed", error)
        })
        reconcileNow().catch((error) => {
          logger.error("Reconcile on connect failed", error)
        })
      },
      (listId) => {
        const existing = pendingPulls.get(listId)
        if (existing) {
          clearTimeout(existing)
        }
        pendingPulls.set(
          listId,
          setTimeout(() => {
            pendingPulls.delete(listId)
            engine.pullList(listId).catch((error) => {
              logger.error(`Pull for list ${listId} failed`, error)
            })
          }, LIST_EVENT_DEBOUNCE_MS)
        )
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engine/listRepository are stable; pullNow/reconcileNow's identity intentionally isn't tracked here.
  }, [engine])

  useEffect(() => {
    if (status !== "signedIn" || !isSyncConfigured()) {
      socket.disconnect()
      return
    }

    const flush = () => {
      engine.flush().catch((error) => {
        logger.error("Flush failed", error)
      })
    }

    // subscribeNow before connect(): the socket sends whatever
    // subscription it has as soon as it opens (see SyncSocket.connect's
    // onopen), so the list ids need to already be set before that races
    // ahead of us.
    subscribeNow().catch((error) => {
      logger.error("Subscribe on mount failed", error)
    })
    // Try immediately rather than waiting for the first trigger - e.g. a
    // list created with sync on while offline should go out as soon as the
    // user (re)gains a signed-in, connected session. Pull before flush:
    // local state should reflect remote before anything new goes out (see
    // SyncEngine.pull's doc comment) - though pull() flushes at its own
    // end too, so this ordering mostly matters for how soon the initial
    // flush's own network round trip starts.
    pullNow().catch((error) => {
      logger.error("Pull on mount failed", error)
    })
    flush()
    socket.connect().catch((error) => {
      logger.error("Failed to connect sync socket", error)
    })

    const unsubscribeOutbox = onOutboxChanged(flush)
    // A list's sync toggle flipping changes both what we should be
    // subscribed to and what we should pull/push for - re-subscribe (and
    // nudge a pull) so a newly-enabled list starts getting live updates
    // immediately rather than waiting for the next reconnect/foreground.
    const unsubscribeSyncLists = onSyncListsChanged(() => {
      subscribeNow().catch((error) => {
        logger.error("Re-subscribe after sync list change failed", error)
      })
      pullNow().catch((error) => {
        logger.error("Pull after sync list change failed", error)
      })
    })

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          pullNow().catch((error) => {
            logger.error("Pull on foreground failed", error)
          })
          flush()
          reconcileNow().catch((error) => {
            logger.error("Reconcile on foreground failed", error)
          })
          socket.connect().catch((error) => {
            logger.error("Failed to reconnect sync socket", error)
          })
        }
      }
    )

    const safetyInterval = setInterval(() => {
      pullNow().catch((error) => {
        logger.error("Periodic pull failed", error)
      })
      reconcileNow().catch((error) => {
        logger.error("Periodic reconcile failed", error)
      })
      socket.reconnectIfTokenChanged().catch((error) => {
        logger.error("Failed to check for token refresh", error)
      })
    }, RECONCILE_SAFETY_INTERVAL_MS)

    return () => {
      unsubscribeOutbox()
      unsubscribeSyncLists()
      appStateSubscription.remove()
      clearInterval(safetyInterval)
      socket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pullNow/reconcileNow/subscribeNow/flush close over stable engine/listRepository/socket.
  }, [status, engine, socket])

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
