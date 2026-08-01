package request

import "github.com/google/uuid"

type SyncStateRequest struct {
	AggregateIDs []uuid.UUID `json:"aggregate_ids"`
}
