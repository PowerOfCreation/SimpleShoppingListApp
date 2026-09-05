package common

import (
	"time"

	"github.com/google/uuid"
)

// ListMembershipResult is one list the caller owns or is a member of - the
// "restore my lists" discovery DTO. No list name: the server holds no list
// content (see ListInviteResult's equivalent note); the client learns names
// by pulling each list's log from seq 0.
type ListMembershipResult struct {
	ListID   uuid.UUID `json:"list_id"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}
