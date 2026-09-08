import { Ingredient } from "@/types/Ingredient"
import { AggregateTypes, DomainEventRow, EventTypes } from "@/types/DomainEvent"

export type CompactionSource = {
  /** Target list id - the new list's id when duplicating. */
  listId: string
  name: string
  ingredients: Ingredient[]
}

export type CompactionContext = {
  /** Mints an event_id for every generated event. */
  newId: () => string
  /** Duplicate: () => uuidv4(). In-place compaction: (i) => i.id, to keep ids stable. */
  ingredientIdFor: (ingredient: Ingredient) => string
  /** occurred_at for todo_list.created and the fallback for ingredients without created_at. */
  occurredAt: number
  clientId: string
}

/**
 * Rebuilds a list's *current projection* as a minimal, history-free event
 * sequence: one todo_list.created plus one ingredient.created per item (with
 * its completed state folded in), and an ingredient.priority_set for items
 * that have a priority. No updated/deleted/priority_cleared events, no past
 * renames - the source's full history is never read. Deliberate fidelity
 * gap: updated_at isn't reproduced (handleCreated derives it from
 * occurred_at), not worth a second event per item just for that.
 *
 * Pure and DB-free - ids and the clock are injected - so it's usable both
 * for duplicating a list (fresh ids) and, later, for compacting an existing
 * list's own log in place (identity ids). All events are seq: null (§6.4:
 * seq has exactly one writer, the pull path) and only use types in
 * SYNCABLE_EVENT_TYPES.
 */
export function compactListToEvents(
  source: CompactionSource,
  ctx: CompactionContext
): DomainEventRow[] {
  const events: DomainEventRow[] = [
    {
      event_id: ctx.newId(),
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: source.listId,
      aggregate_type: AggregateTypes.TODO_LIST,
      list_id: source.listId,
      occurred_at: ctx.occurredAt,
      client_id: ctx.clientId,
      payload: JSON.stringify({ name: source.name }),
      seq: null,
    },
  ]

  for (const ingredient of source.ingredients) {
    const ingredientId = ctx.ingredientIdFor(ingredient)
    const occurredAt = ingredient.created_at ?? ctx.occurredAt

    events.push({
      event_id: ctx.newId(),
      event_type: EventTypes.INGREDIENT_CREATED,
      aggregate_id: ingredientId,
      aggregate_type: AggregateTypes.INGREDIENT,
      list_id: source.listId,
      occurred_at: occurredAt,
      client_id: ctx.clientId,
      payload: JSON.stringify({
        name: ingredient.name,
        listId: source.listId,
        completed: ingredient.completed,
        completedAt: ingredient.completed_at ?? null,
      }),
      seq: null,
    })

    if (ingredient.priority !== undefined) {
      events.push({
        event_id: ctx.newId(),
        event_type: EventTypes.INGREDIENT_PRIORITY_SET,
        aggregate_id: ingredientId,
        aggregate_type: AggregateTypes.INGREDIENT,
        list_id: source.listId,
        occurred_at: occurredAt,
        client_id: ctx.clientId,
        payload: JSON.stringify({ priority: ingredient.priority }),
        seq: null,
      })
    }
  }

  return events
}
