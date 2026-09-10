import { AppState, AppStateStatus, NativeEventSubscription } from "react-native"

import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { SyncEngine } from "@/api/sync/sync-engine"
import {
  SyncSocket,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from "@/api/sync/sync-socket"
import { onOutboxChanged } from "@/api/sync/outbox-events"
import {
  onSyncListsChanged,
  notifySyncListsChanged,
} from "@/api/sync/sync-events"
import { createLogger } from "@/api/common/logger"
import { SharingClient } from "@/api/sharing/sharing-client"

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

// Below this, backgrounding was too brief for the ping/pong watchdog to
// have missed a drop (it only pauses while backgrounded, so it couldn't
// have detected one anyway) - a permission dialog or a notification-shade
// glance shouldn't pay for a full socket teardown and reconnect.
const STALE_AFTER_BACKGROUND_MS = PING_INTERVAL_MS + PONG_TIMEOUT_MS

// Everything scoped to one start()/stop() cycle, grouped so stop() can
// discard it wholesale instead of resetting each field by hand - a field
// reset piecemeal is a field someone eventually forgets to reset (see
// backgroundedAt surviving a stop() in the pre-refactor version of this
// file). The socket lives here too, not in the constructor, so a new
// session always gets a socket with no memory of the previous one's
// subscriptions/backoff/token.
type Session = {
  socket: SyncSocket
  pendingPulls: Map<string, ReturnType<typeof setTimeout>>
  unsubscribeOutbox: () => void
  unsubscribeSyncLists: () => void
  appStateSubscription: NativeEventSubscription
  safetyInterval: ReturnType<typeof setInterval>
  backgroundedAt: number | null
}

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
  private session: Session | null = null

  constructor(
    private readonly engine: SyncEngine,
    private readonly listSyncStateRepository: ListSyncStateRepository,
    private readonly sharingClient: Pick<SharingClient, "listMyLists">
  ) {}

  private debouncedPullList(listId: string): void {
    const session = this.session
    if (!session) return
    const existing = session.pendingPulls.get(listId)
    if (existing) {
      clearTimeout(existing)
    }
    session.pendingPulls.set(
      listId,
      setTimeout(() => {
        session.pendingPulls.delete(listId)
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
    const idsResult = await this.listSyncStateRepository.getEnabledIds()
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
    const idsResult = await this.listSyncStateRepository.getEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Pull: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    await this.engine.pull(idsResult.getValue()!)
  }

  // reconcile's drift check compares the pull cursor against the server
  // head, so it must not run concurrently with a pull still moving that
  // cursor - see sync-design-decisions.md ("Reparatur: voller Re-Pull").
  private async pullThenReconcile(): Promise<void> {
    await this.pullNow()
    await this.reconcileNow()
  }

  /**
   * Restores this account's lists after a reinstall/re-login: asks the
   * server which lists this account owns or is a member of and enables
   * device-local sync for any this device doesn't already know about. Reuses
   * exactly the bootstrap useRedeemInvite does for a single redeemed invite
   * (setEnabled + notifySyncListsChanged, which the onSyncListsChanged
   * handler wired in start() turns into a re-subscribe + re-pull) - just
   * discovering many list ids from the account instead of one from a token.
   *
   * Diffs against getKnownIds(), not getEnabledIds(): a list the user
   * explicitly turned sync off for still has a (disabled) row and must stay
   * off - only a list with no local row at all is "new" here. Diffing
   * against getEnabledIds() would silently flip that user choice back on
   * every time this runs, since the server still lists the account as a
   * member regardless of this device's local setting.
   */
  private async discoverLists(): Promise<void> {
    const myListsResult = await this.sharingClient.listMyLists()
    if (!myListsResult.success) {
      logger.warn(
        "Discover: failed to fetch my lists",
        myListsResult.getError()
      )
      return
    }

    const knownIdsResult = await this.listSyncStateRepository.getKnownIds()
    if (!knownIdsResult.success) {
      logger.error(
        "Discover: failed to load known list ids",
        knownIdsResult.getError()
      )
      return
    }
    const knownIds = new Set(knownIdsResult.getValue()!)

    let discoveredNew = false
    for (const { listId } of myListsResult.getValue()!) {
      if (knownIds.has(listId)) {
        continue
      }
      const enableResult = await this.listSyncStateRepository.setEnabled(
        listId,
        true
      )
      if (!enableResult.success) {
        logger.error(
          `Discover: could not enable sync for list ${listId}`,
          enableResult.getError()
        )
        continue
      }
      discoveredNew = true
    }

    if (discoveredNew) {
      notifySyncListsChanged()
    }
  }

  private async subscribeNow(): Promise<void> {
    const idsResult = await this.listSyncStateRepository.getEnabledIds()
    if (!idsResult.success) {
      logger.error(
        "Subscribe: failed to load sync-enabled list ids",
        idsResult.getError()
      )
      return
    }
    this.session?.socket.subscribe(idsResult.getValue()!)
  }

  /**
   * Wires every trigger and connects the socket. Idempotent - a second
   * call while already running is a no-op rather than double-registering
   * listeners/intervals. Call once per signed-in, sync-configured session.
   */
  start(): void {
    if (this.session) {
      return
    }

    const socket = new SyncSocket(
      () => {
        // Freshly (re)connected is exactly the moment a gap that opened up
        // while disconnected should be caught - both directions: pull
        // anything the server got that we don't have yet, and reconcile
        // (self-heal) anything we believe is synced that the server has no
        // record of. The socket itself already resent our subscriptions
        // from its own onopen, before this fires.
        this.pullThenReconcile().catch((error) => {
          logger.error("Pull/reconcile on connect failed", error)
        })
      },
      (listId) => this.debouncedPullList(listId)
    )

    const unsubscribeOutbox = onOutboxChanged(() => this.flush())
    // A list's sync toggle flipping changes both what we should be
    // subscribed to and what we should pull/push for - re-subscribe (and
    // nudge a pull) so a newly-enabled list starts getting live updates
    // immediately rather than waiting for the next reconnect/foreground.
    const unsubscribeSyncLists = onSyncListsChanged(() => {
      this.subscribeNow().catch((error) => {
        logger.error("Re-subscribe after sync list change failed", error)
      })
      this.pullNow().catch((error) => {
        logger.error("Pull after sync list change failed", error)
      })
    })

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const session = this.session
        if (!session) return
        if (nextState !== "active") {
          session.backgroundedAt ??= Date.now()
          return
        }
        const backgroundedFor = session.backgroundedAt
          ? Date.now() - session.backgroundedAt
          : 0
        session.backgroundedAt = null

        this.pullThenReconcile().catch((error) => {
          logger.error("Pull/reconcile on foreground failed", error)
        })
        this.flush()
        if (backgroundedFor > STALE_AFTER_BACKGROUND_MS) {
          // connect() no-ops if a socket object still exists, but that
          // object's liveness can't be trusted here: the ping/pong watchdog
          // doesn't run while backgrounded (RN timers are paused), so a hop
          // that silently dropped the idle connection leaves onclose never
          // firing. Force a fresh connection instead of relying on the
          // stale one's presence - only worth it once backgrounded long
          // enough for that watchdog to have plausibly missed something.
          session.socket.disconnect()
        }
        session.socket.connect().catch((error) => {
          logger.error("Failed to reconnect sync socket", error)
        })
      }
    )

    const safetyInterval = setInterval(() => {
      this.pullThenReconcile().catch((error) => {
        logger.error("Periodic pull/reconcile failed", error)
      })
      this.session?.socket.reconnectIfTokenChanged().catch((error) => {
        logger.error("Failed to check for token refresh", error)
      })
    }, RECONCILE_SAFETY_INTERVAL_MS)

    this.session = {
      socket,
      pendingPulls: new Map(),
      unsubscribeOutbox,
      unsubscribeSyncLists,
      appStateSubscription,
      safetyInterval,
      backgroundedAt: null,
    }

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
    socket.connect().catch((error) => {
      logger.error("Failed to connect sync socket", error)
    })

    // Fire-and-forget, same as the calls above - its notifySyncListsChanged()
    // (if it finds anything new) can only resolve after the onSyncListsChanged
    // listener below is registered, since everything up to that point in
    // start() runs synchronously before this promise's first await settles.
    this.discoverLists().catch((error) => {
      logger.error("Discover on mount failed", error)
    })
  }

  /** Tears down every trigger and disconnects the socket. Safe to call even if start() never ran, or more than once. */
  stop(): void {
    const session = this.session
    if (!session) return
    this.session = null

    session.unsubscribeOutbox()
    session.unsubscribeSyncLists()
    session.appStateSubscription.remove()
    clearInterval(session.safetyInterval)
    for (const timeout of session.pendingPulls.values()) {
      clearTimeout(timeout)
    }
    session.socket.disconnect()
  }
}
