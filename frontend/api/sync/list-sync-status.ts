import { getPreference, setPreference } from "@/database/preferences-repository"
import { createLogger } from "@/api/common/logger"
import { SyncStatus } from "./sync-status"

// General diagnostics are session-local; permission denial is persisted. A successful download cannot clear an
// upload failure (or vice versa), and another list can never clear either.
type Direction = "push" | "pull" | "reconcile"
type Pass = { active: number; failed: boolean; status: SyncStatus }
const lists = new Map<string, Partial<Record<Direction, Pass>>>()
const permissionDenied = new Map<string, boolean>()
const loading = new Map<string, Promise<void>>()
const writes = new Map<string, Promise<void>>()
const logger = createLogger("ListSyncStatus")
const permissionKey = (listId: string) => `sync_permission_denied:${listId}`

export async function loadListSyncPermission(listId: string): Promise<void> {
  if (permissionDenied.has(listId)) return
  const existing = loading.get(listId)
  if (existing) return existing
  const pending = (async () => {
    try {
      const stored = await getPreference(permissionKey(listId))
      if (!permissionDenied.has(listId)) {
        permissionDenied.set(listId, stored === "true")
        listeners.forEach((listener) => listener())
      }
    } catch (error) {
      logger.warn("Could not load sync permission status", error)
    } finally {
      loading.delete(listId)
    }
  })()
  loading.set(listId, pending)
  return pending
}

export async function setListPermissionDenied(
  listId: string,
  denied: boolean
): Promise<void> {
  if (permissionDenied.get(listId) === denied) return
  permissionDenied.set(listId, denied)
  listeners.forEach((listener) => listener())
  const pending = (writes.get(listId) ?? Promise.resolve()).then(async () => {
    try {
      await setPreference(permissionKey(listId), String(denied))
    } catch (error) {
      logger.warn("Could not save sync permission status", error)
    }
  })
  writes.set(listId, pending)
  await pending
  if (writes.get(listId) === pending) writes.delete(listId)
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
