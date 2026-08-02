/**
 * Pub/sub for pull-driven changes, mirroring outbox-events.ts's pattern
 * (services/engine fire notifications, UI hooks subscribe) but for the
 * other direction: data that changed *because* of a pull rather than a
 * local write, which the UI would otherwise never learn about until its
 * next unrelated remount.
 */

type ListDataListener = (listId: string) => void
type SyncListsListener = () => void

const listDataListeners = new Set<ListDataListener>()
const syncListsListeners = new Set<SyncListsListener>()

/** Fired after a pull applies new events for a list (see event-applier.ts). */
export function onListDataChanged(listener: ListDataListener): () => void {
  listDataListeners.add(listener)
  return () => listDataListeners.delete(listener)
}

export function notifyListDataChanged(listId: string): void {
  for (const listener of listDataListeners) {
    listener(listId)
  }
}

/**
 * Fired when the set of sync-enabled lists changes (a list's sync toggle
 * flips) - consumed by the sync provider to re-subscribe over the
 * WebSocket and re-run reconcile/pull for the new set.
 */
export function onSyncListsChanged(listener: SyncListsListener): () => void {
  syncListsListeners.add(listener)
  return () => syncListsListeners.delete(listener)
}

export function notifySyncListsChanged(): void {
  for (const listener of syncListsListeners) {
    listener()
  }
}
