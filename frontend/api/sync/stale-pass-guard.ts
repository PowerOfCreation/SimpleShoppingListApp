import { REQUEST_TIMEOUT_MS } from "@/api/sync/config"

// Every real request already gives up after REQUEST_TIMEOUT_MS
// (AbortController), and every unit of sync work (a request, a per-item DB
// write) touches its scope when it completes - so this only ever needs to
// cover the gap between two such units, not a pass's total duration.
const STALE_MULTIPLIER = 3
const STALE_AFTER_MS = REQUEST_TIMEOUT_MS * STALE_MULTIPLIER

type PassHandle = { onStale: () => void }

type Scope = {
  timeout: ReturnType<typeof setTimeout> | null
  passes: Set<PassHandle>
}

// "global" is the app-wide aggregate (sync-status.ts); every other key is a
// list id (list-sync-status.ts). One map for both so a single touch call can
// renew whichever scopes are actually open without the caller needing to
// know who's listening.
const scopes = new Map<string, Scope>()

function getScope(key: string): Scope {
  let scope = scopes.get(key)
  if (!scope) {
    scope = { timeout: null, passes: new Set() }
    scopes.set(key, scope)
  }
  return scope
}

function arm(scope: Scope): void {
  scope.timeout = setTimeout(() => {
    scope.timeout = null
    const stale = [...scope.passes]
    scope.passes.clear()
    for (const pass of stale) pass.onStale()
  }, STALE_AFTER_MS)
}

function touchScope(key: string): void {
  const scope = scopes.get(key)
  if (!scope || scope.passes.size === 0) return
  if (scope.timeout) clearTimeout(scope.timeout)
  arm(scope)
}

/**
 * Proves every pass currently open on these list ids (and the global
 * aggregate) is still making progress. Call this wherever a unit of sync
 * work just completed - a request, a DB write - never per pass: a pass
 * nested inside another on the same list (e.g. reconcile's repair
 * triggering a pull) shares that list's scope and is kept alive by the
 * nested pass's own touches, with nothing extra to remember at the outer
 * call site.
 */
export function touchSyncProgress(listIds: (string | null)[]): void {
  touchScope("global")
  for (const id of listIds) {
    if (id !== null) touchScope(id)
  }
}

/**
 * Registers one in-progress pass under `key`. onStale fires at most once, if
 * touchSyncProgress doesn't reach this key for STALE_AFTER_MS while this
 * pass (or a sibling sharing the same key) is still open - it must only
 * correct local state, never retry, since it can't tell "gone" from "still
 * working". The returned finish() is idempotent, and reports false if the
 * watchdog already gave up on this pass.
 */
export function startGuardedPass(
  key: string,
  onStale: () => void
): { finish: () => boolean } {
  const scope = getScope(key)
  if (scope.passes.size === 0) {
    arm(scope)
  }
  const pass: PassHandle = { onStale }
  scope.passes.add(pass)

  return {
    finish: () => {
      const removed = scope.passes.delete(pass)
      if (removed && scope.passes.size === 0 && scope.timeout) {
        clearTimeout(scope.timeout)
        scope.timeout = null
      }
      return removed
    },
  }
}
