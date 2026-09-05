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

type RedeemListInviteResponse struct {
	ListID uuid.UUID `json:"list_id"`
	Role   string    `json:"role"`
	// AlreadyMember is true when the caller was already a member before
	// this redeem - a successful no-op, not an error.
	AlreadyMember bool `json:"already_member"`
	// ListName is a client-supplied snapshot from when the invite was
	// created - it can be stale if the list was renamed since. See
	// entities.ListInvite.ListName.
	ListName    string `json:"list_name"`
	MemberCount int    `json:"member_count"`
	// InvitedByName/InvitedByPictureURL are null when the inviter's
	// Keycloak profile didn't carry them at invite-creation time.
	InvitedByName       *string `json:"invited_by_name"`
	InvitedByPictureURL *string `json:"invited_by_picture_url"`
}

// InvitePreviewResponse is the read-only counterpart of
// RedeemListInviteResponse - same fields, but resolving the token never
// joins the caller to the list.
type InvitePreviewResponse struct {
	ListID              uuid.UUID `json:"list_id"`
	ListName            string    `json:"list_name"`
	MemberCount         int       `json:"member_count"`
	InvitedByName       *string   `json:"invited_by_name"`
	InvitedByPictureURL *string   `json:"invited_by_picture_url"`
}
