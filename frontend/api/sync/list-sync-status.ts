import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import {
  startGuardedPass,
  clearGuardScope,
  SyncPass,
  SyncProgress,
} from "@/api/sync/stale-pass-guard"
import { SyncStatus } from "./sync-status"

// General diagnostics are session-local; permission denial and the server's
// rejection reason are persisted in list_sync_state (see
// ListSyncStateRepository.setPermissionDenied / setRejectionReason),
// so they survive an app restart and is cleaned up automatically when the
// list itself is deleted. A successful download cannot clear an upload
// failure (or vice versa), and another list can never clear either.
type Direction = "push" | "pull" | "reconcile"
type Pass = { active: number; failed: boolean; status: SyncStatus }
const lists = new Map<string, Partial<Record<Direction, Pass>>>()
const permissionDenied = new Map<string, boolean>()
const rejections = new Map<string, string | null>()
const loading = new Map<string, Promise<void>>()
const logger = createLogger("ListSyncStatus")

export async function loadListSyncPermission(listId: string): Promise<void> {
  if (permissionDenied.has(listId)) return
  const existing = loading.get(listId)
  if (existing) return existing
  const pending = (async () => {
    const repository = new ListSyncStateRepository(getDatabase())
    const result = await repository.isPermissionDenied(listId)
    if (!result.success) {
      logger.warn("Could not load sync permission status", result.getError())
    }
    const rejection = await repository.getRejectionReason(listId)
    if (!rejection.success) {
      logger.warn("Could not load sync rejection reason", rejection.getError())
    }
    if (!permissionDenied.has(listId)) {
      permissionDenied.set(listId, result.success && result.getValue()!)
    }
    if (!rejections.has(listId)) {
      rejections.set(listId, rejection.success ? rejection.getValue()! : null)
    }
    listeners.forEach((listener) => listener())
    loading.delete(listId)
  })()
  loading.set(listId, pending)
  return pending
}

/** Drops cached status for a list whose list_sync_state row was just removed (logout, list deletion). */
export function clearListSyncStatus(listId: string): void {
  lists.delete(listId)
  permissionDenied.delete(listId)
  rejections.delete(listId)
  loading.delete(listId)
  clearGuardScope(listId)
  listeners.forEach((listener) => listener())
}

export async function setListPermissionDenied(
  listId: string,
  denied: boolean
): Promise<void> {
  if (permissionDenied.get(listId) === denied) return
  permissionDenied.set(listId, denied)
  listeners.forEach((listener) => listener())
  const result = await new ListSyncStateRepository(
    getDatabase()
  ).setPermissionDenied(listId, denied)
  if (!result.success) {
    logger.warn("Could not save sync permission status", result.getError())
  }
}

/** Records (or, with null, clears) why the server permanently rejected a list's events. */
export async function setListSyncRejection(
  listId: string,
  reason: string | null
): Promise<void> {
  if (rejections.has(listId) && rejections.get(listId) === reason) return
  rejections.set(listId, reason)
  listeners.forEach((listener) => listener())
  const result = await new ListSyncStateRepository(
    getDatabase()
  ).setRejectionReason(listId, reason)
  if (!result.success) {
    logger.warn("Could not save sync rejection reason", result.getError())
  }
}

export function getListSyncRejection(listId: string): string | undefined {
  return rejections.get(listId) ?? undefined
}

const listeners = new Set<() => void>()

export function onListSyncStatusChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getListSyncStatus(
  listId: string
): SyncStatus | "forbidden" | "rejected" | undefined {
  if (permissionDenied.get(listId)) return "forbidden"
  if (rejections.get(listId)) return "rejected"
  const passes = Object.values(lists.get(listId) ?? {})
  if (passes.some((pass) => pass.status === "error")) return "error"
  if (passes.some((pass) => pass.active > 0)) return "syncing"
  return passes.length > 0 ? "synced" : undefined
}

/** Each pass owns its liveness; only explicitly linked child work renews it. */
export function startListSync(
  listId: string,
  direction: Direction,
  parentProgress?: SyncProgress
): SyncPass {
  const state = lists.get(listId) ?? {}
  const pass = state[direction] ?? {
    active: 0,
    failed: false,
    status: "syncing",
  }
  if (pass.active === 0) {
    pass.failed = false
    pass.status = "syncing"
  }
  pass.active++
  state[direction] = pass
  lists.set(listId, state)
  listeners.forEach((listener) => listener())

  const settle = (ok: boolean) => {
    pass.failed ||= !ok
    pass.active--
    if (pass.failed) pass.status = "error"
    else if (pass.active === 0) pass.status = "synced"
    listeners.forEach((listener) => listener())
  }
  const guard = startGuardedPass(
    listId,
    () => {
      logger.warn(
        `Sync pass for list ${listId} (${direction}) never finished - clearing stuck "syncing" state`
      )
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
