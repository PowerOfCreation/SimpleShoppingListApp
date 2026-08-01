package response

import "github.com/google/uuid"

type SyncStateResponse struct {
	KnownEventIDs []uuid.UUID `json:"known_event_ids"`
}
