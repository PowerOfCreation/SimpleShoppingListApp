package request

import "github.com/google/uuid"

type SyncHeadRequest struct {
	ListIDs []uuid.UUID `json:"list_ids"`
}
