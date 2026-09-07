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

/** Nested pull/flush passes count as one attempt. */
export function reportSyncStarted(): void {
  if (activePasses++ === 0) {
    passFailed = false
    update({ status: "syncing", lastAttemptAt: Date.now(), error: null })
  }
}

export function reportSyncFinished(ok: boolean): void {
  passFailed = (activePasses > 0 && passFailed) || !ok
  activePasses = Math.max(0, activePasses - 1)
  if (activePasses > 0) return
  update({
    status: passFailed ? "error" : "synced",
    lastSuccessAt: passFailed ? details.lastSuccessAt : Date.now(),
    error: passFailed ? "Sync failed. Please try again later." : null,
  })
}
