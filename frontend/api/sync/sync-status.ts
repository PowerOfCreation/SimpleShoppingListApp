import { createLogger } from "@/api/common/logger"
import {
  startGuardedPass,
  SyncPass,
  SyncProgress,
} from "@/api/sync/stale-pass-guard"

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

/** Independent operations share their displayed outcome, not their deadline. */
export function reportSyncStarted(parentProgress?: SyncProgress): SyncPass {
  if (activePasses++ === 0) {
    passFailed = false
    update({ status: "syncing", lastAttemptAt: Date.now(), error: null })
  }
  const settle = (ok: boolean) => {
    passFailed ||= !ok
    activePasses--
    if (activePasses > 0 && !passFailed) return
    update({
      status: passFailed ? "error" : "synced",
      lastSuccessAt: passFailed ? details.lastSuccessAt : Date.now(),
      error: passFailed ? "Sync failed. Please try again later." : null,
    })
  }
  const guard = startGuardedPass(
    "global",
    () => {
      logger.warn("Sync operation stopped making progress")
      settle(false)
    },
    parentProgress
  )
  return {
    progress: guard.progress,
    finish: (ok: boolean) => {
      if (guard.finish()) settle(ok)
    },
  }
}
