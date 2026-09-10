import { createLogger } from "@/api/common/logger"
import { startGuardedPass } from "@/api/sync/stale-pass-guard"

const logger = createLogger("SyncStatus")

/** Observational, device-local sync diagnostics for the current app session. */
export type SyncStatus = "synced" | "syncing" | "error"

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
const listeners = new Set<() => void>()

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

/**
 * Nested pull/flush passes count as one attempt - only the outermost call
 * updates SyncDetails; touchSyncProgress (called from wherever a unit of
 * sync work completes) is what keeps the whole nest alive.
 */
export function reportSyncStarted(): { finish: (ok: boolean) => void } {
  const isOuterPass = activePasses === 0
  activePasses++
  if (isOuterPass) {
    passFailed = false
    update({ status: "syncing", lastAttemptAt: Date.now(), error: null })
  }

  const guard = startGuardedPass("global", () => {
    logger.warn(
      'Sync status stuck on "syncing" past the request timeout - clearing it'
    )
    activePasses = 0
    passFailed = true
    update({
      status: "error",
      error: "Sync failed. Please try again later.",
    })
  })

  return {
    finish: (ok: boolean) => {
      if (!guard.finish()) return
      passFailed = passFailed || !ok
      activePasses = Math.max(0, activePasses - 1)
      if (activePasses > 0) return
      update({
        status: passFailed ? "error" : "synced",
        lastSuccessAt: passFailed ? details.lastSuccessAt : Date.now(),
        error: passFailed ? "Sync failed. Please try again later." : null,
      })
    },
  }
}
