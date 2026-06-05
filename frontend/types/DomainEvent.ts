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
} as const

export const AggregateTypes = {
  TODO_LIST: "todo_list",
} as const
