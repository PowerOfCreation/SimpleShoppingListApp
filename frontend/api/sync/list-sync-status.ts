import { ListSyncStateRepository } from "@/database/list-sync-state-repository"
import { getDatabase } from "@/database/database"
import { createLogger } from "@/api/common/logger"
import { SyncStatus } from "./sync-status"

// General diagnostics are session-local; permission denial is persisted in
// list_sync_state (see ListSyncStateRepository.setPermissionDenied),
// so it survives an app restart and is cleaned up automatically when the
// list itself is deleted. A successful download cannot clear an upload
// failure (or vice versa), and another list can never clear either.
type Direction = "push" | "pull" | "reconcile"
type Pass = { active: number; failed: boolean; status: SyncStatus }
const lists = new Map<string, Partial<Record<Direction, Pass>>>()
const permissionDenied = new Map<string, boolean>()
const loading = new Map<string, Promise<void>>()
const logger = createLogger("ListSyncStatus")

export async function loadListSyncPermission(listId: string): Promise<void> {
  if (permissionDenied.has(listId)) return
  const existing = loading.get(listId)
  if (existing) return existing
  const pending = (async () => {
    const result = await new ListSyncStateRepository(
      getDatabase()
    ).isPermissionDenied(listId)
    if (!result.success) {
      logger.warn("Could not load sync permission status", result.getError())
    }
    if (!permissionDenied.has(listId)) {
      permissionDenied.set(listId, result.success && result.getValue()!)
      listeners.forEach((listener) => listener())
    }
    loading.delete(listId)
  })()
  loading.set(listId, pending)
  return pending
}

/** Drops cached status for a list whose list_sync_state row was just removed (logout, list deletion). */
export function clearListSyncStatus(listId: string): void {
  lists.delete(listId)
  permissionDenied.delete(listId)
  loading.delete(listId)
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

const listeners = new Set<() => void>()

export function onListSyncStatusChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getListSyncStatus(
  listId: string
): SyncStatus | "forbidden" | undefined {
  if (permissionDenied.get(listId)) return "forbidden"
  const passes = Object.values(lists.get(listId) ?? {})
  if (passes.some((pass) => pass.status === "error")) return "error"
  if (passes.some((pass) => pass.active > 0)) return "syncing"
  return passes.length > 0 ? "synced" : undefined
}

/** Returns a completion callback; overlapping operations share their result. */
export function startListSync(listId: string, direction: Direction) {
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
  return (ok: boolean) => {
    pass.failed ||= !ok
    pass.active--
    if (pass.active === 0) pass.status = pass.failed ? "error" : "synced"
    listeners.forEach((listener) => listener())
  }
}
