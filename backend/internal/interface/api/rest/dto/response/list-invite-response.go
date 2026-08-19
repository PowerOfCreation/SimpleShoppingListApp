package response

import (
	"time"

	"github.com/google/uuid"
)

// CreateListInviteResponse is the only wire shape that ever carries the
// plaintext token - see entities.InviteToken. Once this response is sent,
// the token exists nowhere else; only its hash is persisted.
type CreateListInviteResponse struct {
	InviteID  uuid.UUID `json:"invite_id"`
	ListID    uuid.UUID `json:"list_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// ListInviteResponse is the invite DTO used everywhere except creation -
// deliberately no token field.
type ListInviteResponse struct {
	InviteID  uuid.UUID `json:"invite_id"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ListInvitesResponse struct {
	Invites []ListInviteResponse `json:"invites"`
}

// No list name: the server holds no list content. The client creates the
// list locally by pulling its log from seq 0 (see sync-sharing-target.md 4.3).
type RedeemListInviteResponse struct {
	ListID uuid.UUID `json:"list_id"`
	Role   string    `json:"role"`
	// AlreadyMember is true when the caller was already a member before
	// this redeem - a successful no-op, not an error.
	AlreadyMember bool `json:"already_member"`
}
