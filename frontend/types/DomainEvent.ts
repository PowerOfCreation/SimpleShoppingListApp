export type DomainEventRow = {
  event_id: string
  event_type: string
  aggregate_id: string
  aggregate_type: string
  occurred_at: number
  client_id: string
  payload: string
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
 * explicit allowlist rather than a `todo_list.*` prefix match: a prefix
 * match would silently send a newly added `todo_list.*` event type the
 * moment it's introduced without checking whether the backend can handle
 * it. `todo_list.sync_enabled`/`sync_disabled` are deliberately included so
 * the backend learns about sync state changes; it currently ignores them
 * (forward compat), but a future prompt may give them real behaviour.
 */
export const SYNCABLE_EVENT_TYPES: readonly string[] = [
  EventTypes.TODO_LIST_CREATED,
  EventTypes.TODO_LIST_UPDATED,
  EventTypes.TODO_LIST_DELETED,
  EventTypes.TODO_LIST_SYNC_ENABLED,
  EventTypes.TODO_LIST_SYNC_DISABLED,
]
