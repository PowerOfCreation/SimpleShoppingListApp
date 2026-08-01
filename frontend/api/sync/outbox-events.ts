/**
 * Minimal pub/sub so services that enqueue outbox rows (ShoppingListService)
 * can nudge the sync engine to flush soon, without holding a direct
 * reference to it. The engine is constructed lazily inside SyncProvider
 * (after the database is initialized and migrated), so nothing outside the
 * provider can safely import it directly - this is the seam instead.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function onOutboxChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyOutboxChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
