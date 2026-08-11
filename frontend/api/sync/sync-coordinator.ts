import { AppState, AppStateStatus, NativeEventSubscription } from "react-native"

import { ListSyncSettingsRepository } from "@/database/list-sync-settings-repository"
import { SyncEngine } from "@/api/sync/sync-engine"
import { SyncSocket } from "@/api/sync/sync-socket"
import { onOutboxChanged } from "@/api/sync/outbox-events"
import { onSyncListsChanged } from "@/api/sync/sync-events"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("SyncCoordinator")

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

/**
 * Wires a SyncEngine and SyncSocket into the app lifecycle: pull/reconcile
 * on connect, foreground, and a periodic safety interval; flush on outbox
 * change; a debounced pull per list on a WebSocket "new event"
 * notification; and re-subscribe when the set of sync-enabled lists
 * changes. Plain TS (no React) so it's testable without mounting a
 * component - SyncProvider just start()s one on sign-in and stop()s it on
 * sign-out/unmount.
 */
export class SyncCoordinator {
  private readonly socket: SyncSocket
  private readonly pendingPulls = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private running = false
  private unsubscribeOutbox?: () => void
  private unsubscribeSyncLists?: () => void
  private appStateSubscription?: NativeEventSubscription
  private safetyInterval?: ReturnType<typeof setInterval>

  constructor(
    private readonly engine: SyncEngine,
    private readonly listSyncSettingsRepository: ListSyncSettingsRepository
  ) {
    this.socket = new SyncSocket(
      (eventId, seq) => {
        this.engine.handleAck(eventId, seq).catch((error) => {
          logger.error("Failed to handle ack", error)
        })
      },
      () => {
        // Freshly (re)connected is exactly the moment a gap that opened up
        // while disconnected should be caught - both directions: pull
        // anything the server got that we don't have yet, and reconcile
        // (self-heal) anything we sent that never got acked. The socket
        // itself already resent our subscriptions from its own onopen,
        // before this fires.
        this.pullNow().catch((error) => {
          logger.error("Pull on connect failed", error)
        })
        this.reconcileNow().catch((error) => {
          logger.error("Reconcile on connect failed", error)
        })
      },
      (listId) => this.debouncedPullList(listId)
    )
  }

  private debouncedPullList(listId: string): void {
    const existing = this.pendingPulls.get(listId)
    if (existing) {
      clearTimeout(existing)
    }
    this.pendingPulls.set(
      listId,
      setTimeout(() => {
        this.pendingPulls.delete(listId)
        this.engine.pullList(listId).catch((error) => {
          logger.error(`Pull for list ${listId} failed`, error)
        })
      }, LIST_EVENT_DEBOUNCE_MS)
    )
  }

  private flush(): void {
    this.engine.flush().catch((error) => {
      logger.error("Flush failed", error)
    })
  }

  private async reconcileNow(): Promise<void> {
    const idsResult = await this.listSyncSettingsRepository.getEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Reconcile: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    await this.engine.reconcile(idsResult.getValue()!)
  }

  private async pullNow(): Promise<void> {
    const idsResult = await this.listSyncSettingsRepository.getEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Pull: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    await this.engine.pull(idsResult.getValue()!)
  }

  private async subscribeNow(): Promise<void> {
    const idsResult = await this.listSyncSettingsRepository.getEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Subscribe: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    this.socket.subscribe(idsResult.getValue()!)
  }

  /**
   * Wires every trigger and connects the socket. Idempotent - a second
   * call while already running is a no-op rather than double-registering
   * listeners/intervals. Call once per signed-in, sync-configured session.
   */
  start(): void {
    if (this.running) {
      return
    }
    this.running = true

    // subscribeNow before connect(): the socket sends whatever
    // subscription it has as soon as it opens (see SyncSocket.connect's
    // onopen), so the list ids need to already be set before that races
    // ahead of us.
    this.subscribeNow().catch((error) => {
      logger.error("Subscribe on mount failed", error)
    })
    // Try immediately rather than waiting for the first trigger - e.g. a
    // list created with sync on while offline should go out as soon as the
    // user (re)gains a signed-in, connected session. Pull before flush:
    // local state should reflect remote before anything new goes out -
    // chained via .finally() (not awaited) so it doesn't block connect()/
    // subscribeNow() below; engine.pull() already flushes on success, this
    // is the fallback for when pullNow() fails before reaching that.
    this.pullNow()
      .catch((error) => {
        logger.error("Pull on mount failed", error)
      })
      .finally(() => this.flush())
    this.socket.connect().catch((error) => {
      logger.error("Failed to connect sync socket", error)
    })

    this.unsubscribeOutbox = onOutboxChanged(() => this.flush())
    // A list's sync toggle flipping changes both what we should be
    // subscribed to and what we should pull/push for - re-subscribe (and
    // nudge a pull) so a newly-enabled list starts getting live updates
    // immediately rather than waiting for the next reconnect/foreground.
    this.unsubscribeSyncLists = onSyncListsChanged(() => {
      this.subscribeNow().catch((error) => {
        logger.error("Re-subscribe after sync list change failed", error)
      })
      this.pullNow().catch((error) => {
        logger.error("Pull after sync list change failed", error)
      })
    })

    this.appStateSubscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          this.pullNow().catch((error) => {
            logger.error("Pull on foreground failed", error)
          })
          this.flush()
          this.reconcileNow().catch((error) => {
            logger.error("Reconcile on foreground failed", error)
          })
          this.socket.connect().catch((error) => {
            logger.error("Failed to reconnect sync socket", error)
          })
        }
      }
    )

    this.safetyInterval = setInterval(() => {
      this.pullNow().catch((error) => {
        logger.error("Periodic pull failed", error)
      })
      this.reconcileNow().catch((error) => {
        logger.error("Periodic reconcile failed", error)
      })
      this.socket.reconnectIfTokenChanged().catch((error) => {
        logger.error("Failed to check for token refresh", error)
      })
    }, RECONCILE_SAFETY_INTERVAL_MS)
  }

  /** Tears down every trigger and disconnects the socket. Safe to call even if start() never ran, or more than once. */
  stop(): void {
    this.running = false
    this.unsubscribeOutbox?.()
    this.unsubscribeSyncLists?.()
    this.appStateSubscription?.remove()
    if (this.safetyInterval) {
      clearInterval(this.safetyInterval)
    }
    for (const timeout of this.pendingPulls.values()) {
      clearTimeout(timeout)
    }
    this.pendingPulls.clear()
    this.socket.disconnect()
  }
}
