/**
 * Tracks the sync engine's current activity for UI display (e.g. the home
 * screen's header icon) - purely observational, sync logic itself never
 * reads it back. Mirrors sync-events.ts's pub/sub pattern.
 */

export type SyncStatus = "synced" | "syncing" | "error"

let status: SyncStatus = "synced"
const listeners = new Set<() => void>()

export function getSyncStatus(): SyncStatus {
  return status
}

export function onSyncStatusChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: SyncStatus): void {
  if (status === next) {
    return
  }
  status = next
  for (const listener of listeners) {
    listener()
  }
}

/** Called when a pull/flush pass starts talking to the server. */
export function reportSyncStarted(): void {
  setStatus("syncing")
}

/** Called when a pull/flush pass finishes - ok reflects whether every step it covered succeeded. */
export function reportSyncFinished(ok: boolean): void {
  setStatus(ok ? "synced" : "error")
}
