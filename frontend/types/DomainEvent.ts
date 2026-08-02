export type DomainEventRow = {
  event_id: string
  event_type: string
  aggregate_id: string
  aggregate_type: string
  // The list this event belongs to, for list-scoped sync (pull/reconcile).
  // Equal to aggregate_id for todo_list.* events; resolved from local state
  // at creation time for ingredient.* events, whose aggregate_id is the
  // ingredient, not the list. Nullable: older rows predate this column and
  // some ingredient events may have no resolvable list (see migration-5's
  // backfill) - such events are simply never synced.
  list_id: string | null
  occurred_at: number
  client_id: string
  payload: string
  // The server's pull cursor position for this event. Null means "not yet
  // acked/pulled" - our own unconfirmed local write, or an event on a list
  // that was never synced. Once set, it's the authoritative replay order
  // (see byServerSeqThenLocal).
  seq: number | null
}

/**
 * Replay order for a merged (local + pulled) event history: events the
 * server has confirmed (seq set) sort by seq, ahead of our own
 * unconfirmed writes (seq null), which keep whatever order the caller
 * handed them in (their local insertion order). This mirrors a rebase:
 * the confirmed prefix is the server's order, unconfirmed local writes are
 * the tail replayed on top. occurred_at plays no role - device clocks
 * aren't trusted for ordering. Used by the list-scoped rebuildForList
 * methods (ingredient-projection.ts, ingredient-list-projection.ts).
 */
export function byServerSeqThenLocal(
  a: DomainEventRow,
  b: DomainEventRow
): number {
  if (a.seq !== null && b.seq !== null) {
    return a.seq - b.seq
  }
  if (a.seq === null && b.seq === null) {
    return 0
  }
  return a.seq === null ? 1 : -1
}

export const EventTypes = {
  TODO_LIST_CREATED: "todo_list.created",
  TODO_LIST_UPDATED: "todo_list.updated",
  TODO_LIST_DELETED: "todo_list.deleted",
  // Sync opt-in/out gets its own event rather than folding a flag into
  // todo_list.updated, mirroring the existing
  // ingredient.priority_set/priority_cleared pair. These are sent to the
  // backend so it can associate lists with an account / be told sync was
  // turned off, but the backend currently has no handler for them (see
  // SYNCABLE_EVENT_TYPES below).
  TODO_LIST_SYNC_ENABLED: "todo_list.sync_enabled",
  TODO_LIST_SYNC_DISABLED: "todo_list.sync_disabled",
  INGREDIENT_CREATED: "ingredient.created",
  INGREDIENT_UPDATED: "ingredient.updated",
  INGREDIENT_DELETED: "ingredient.deleted",
  INGREDIENT_PRIORITY_SET: "ingredient.priority_set",
  INGREDIENT_PRIORITY_CLEARED: "ingredient.priority_cleared",
} as const

export const AggregateTypes = {
  TODO_LIST: "todo_list",
  INGREDIENT: "ingredient",
} as const

/**
 * Event types that are ever enqueued for sync to the backend. This is an
 * explicit allowlist rather than a `todo_list.*`/`ingredient.*` prefix
 * match: a prefix match would silently send a newly added event type the
 * moment it's introduced without checking whether the backend can handle
 * it. `todo_list.sync_enabled`/`sync_disabled` are deliberately included so
 * the backend learns about sync state changes; it currently ignores them
 * (forward compat), but a future prompt may give them real behaviour.
 *
 * The backend stores and relays every ingredient.* type without a
 * dedicated handler - same forward-compat no-op path as sync_enabled -
 * since list *content* sync only needs the event log to round-trip, not a
 * server-side ingredients projection (see sync-design-decisions.md).
 */
export const SYNCABLE_EVENT_TYPES: readonly string[] = [
  EventTypes.TODO_LIST_CREATED,
  EventTypes.TODO_LIST_UPDATED,
  EventTypes.TODO_LIST_DELETED,
  EventTypes.TODO_LIST_SYNC_ENABLED,
  EventTypes.TODO_LIST_SYNC_DISABLED,
  EventTypes.INGREDIENT_CREATED,
  EventTypes.INGREDIENT_UPDATED,
  EventTypes.INGREDIENT_DELETED,
  EventTypes.INGREDIENT_PRIORITY_SET,
  EventTypes.INGREDIENT_PRIORITY_CLEARED,
]
