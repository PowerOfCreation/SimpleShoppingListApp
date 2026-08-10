package common

import (
	"time"

	"github.com/google/uuid"
)

// ListInviteResult is the invite DTO used everywhere except the moment of
// creation - it deliberately carries no token, see CreateListInviteResult.
type ListInviteResult struct {
	ID        uuid.UUID `json:"id"`
	ListID    uuid.UUID `json:"list_id"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}
