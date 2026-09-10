import { REQUEST_TIMEOUT_MS } from "@/api/sync/sync-client"
import { createLogger } from "@/api/common/logger"

const logger = createLogger("SyncStatus")

/** Observational, device-local sync diagnostics for the current app session. */
export type SyncStatus = "synced" | "syncing" | "error"

// A flush()/pull() call can chain several sequential requests (paging,
// MAX_DRAIN_BATCHES); this only needs to be well past the worst normal
// case, since it exists solely to catch a reportSyncFinished() that never
// arrives (e.g. a request frozen mid-flight by app backgrounding) - see the
// identical guard in list-sync-status.ts.
const STALE_SYNC_MS = REQUEST_TIMEOUT_MS * 12

type SyncDetails = {
  status: SyncStatus
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  error: string | null
}

let details: SyncDetails = {
  status: "synced",
  lastAttemptAt: null,
  lastSuccessAt: null,
  error: null,
}
let activePasses = 0
let passFailed = false
let watchdog: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

export function getSyncStatus(): SyncStatus {
  return details.status
}

export function getSyncDetails(): SyncDetails {
  return details
}

export function onSyncStatusChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(next: Partial<SyncDetails>): void {
  details = { ...details, ...next }
  for (const listener of listeners) listener()
}

/** Nested pull/flush passes count as one attempt. */
export function reportSyncStarted(): void {
  if (activePasses++ === 0) {
    passFailed = false
    update({ status: "syncing", lastAttemptAt: Date.now(), error: null })
    clearWatchdog()
    watchdog = setTimeout(() => {
      logger.warn(
        'Sync status stuck on "syncing" past the request timeout - clearing it'
      )
      activePasses = 0
      passFailed = true
      watchdog = null
      update({
        status: "error",
        error: "Sync failed. Please try again later.",
      })
    }, STALE_SYNC_MS)
  }
}

export function reportSyncFinished(ok: boolean): void {
  passFailed = (activePasses > 0 && passFailed) || !ok
  activePasses = Math.max(0, activePasses - 1)
  if (activePasses > 0) return
  clearWatchdog()
  update({
    status: passFailed ? "error" : "synced",
    lastSuccessAt: passFailed ? details.lastSuccessAt : Date.now(),
    error: passFailed ? "Sync failed. Please try again later." : null,
  })
}
