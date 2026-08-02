package request

import "github.com/google/uuid"

// ListIDs, not AggregateIDs: reconcile used to be keyed by aggregate_id,
// which happened to equal the list id for every syncable event because
// only todo_list.* events were ever syncable. Now that ingredient.* events
// are too (aggregate_id = the ingredient, not the list), a client would
// have to enumerate every ingredient id in a list instead of the one
// list_id it already has - see sync-design-decisions.md.
type SyncStateRequest struct {
	ListIDs []uuid.UUID `json:"list_ids"`
}
