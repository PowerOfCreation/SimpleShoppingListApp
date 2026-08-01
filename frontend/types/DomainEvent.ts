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
  // ingredient.priority_set/priority_cleared pair. These stay local only -
  // see SYNCABLE_EVENT_TYPES below - the server has no notion of them.
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
 * explicit allowlist rather than a `todo_list.*` prefix match, because
 * `todo_list.sync_enabled`/`sync_disabled` are a purely local decision - the
 * backend has no matching handler for them and never should. A prefix match
 * would silently start sending them the moment someone adds a new
 * `todo_list.*` event type without checking this list.
 */
export const SYNCABLE_EVENT_TYPES: readonly string[] = [
  EventTypes.TODO_LIST_CREATED,
  EventTypes.TODO_LIST_UPDATED,
  EventTypes.TODO_LIST_DELETED,
]
