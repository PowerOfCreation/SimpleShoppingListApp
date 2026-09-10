import { REQUEST_TIMEOUT_MS } from "@/api/sync/config"

const STALE_AFTER_MS = REQUEST_TIMEOUT_MS * 3

export type SyncProgress = () => void
export type SyncPass = { progress: SyncProgress; finish: (ok: boolean) => void }

type Guard = { cancel: () => void }
// Keys only support disposal (e.g. list deletion), never shared liveness.
const scopes = new Map<string, Set<Guard>>()

/**
 * Each operation owns its deadline. Only its own progress and explicitly
 * linked children can renew it; an unrelated operation on the same list
 * cannot conceal a hang. Expiry changes diagnostics, not database locks:
 * a transaction must settle before another writer may safely replace it.
 */
export function startGuardedPass(
  key: string,
  onStale: () => void,
  parentProgress?: SyncProgress
): { progress: SyncProgress; finish: () => boolean } {
  const passes = scopes.get(key) ?? new Set<Guard>()
  scopes.set(key, passes)
  let active = true
  let timeout: ReturnType<typeof setTimeout>
  const finish = (): boolean => {
    if (!active) return false
    active = false
    clearTimeout(timeout)
    passes.delete(guard)
    if (passes.size === 0 && scopes.get(key) === passes) scopes.delete(key)
    return true
  }
  const guard: Guard = { cancel: finish }
  const progress = () => {
    if (!active) return
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (finish()) onStale()
    }, STALE_AFTER_MS)
    parentProgress?.()
  }
  passes.add(guard)
  progress()
  return { progress, finish }
}

/** Retire handles as well as timers, so late work cannot revive a cleared key. */
export function clearGuardScope(key: string): void {
  for (const guard of scopes.get(key) ?? []) guard.cancel()
}
