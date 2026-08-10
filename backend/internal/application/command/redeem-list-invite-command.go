package command

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type RedeemListInviteCommand struct {
	Token string
	// UserID is the caller's verified Keycloak subject - never taken from
	// the request body.
	UserID string
}

type RedeemListInviteCommandResult struct {
	ListID   uuid.UUID
	ListName string
	Role     entities.ListMemberRole
	// AlreadyMember is true when the caller was already a member of the
	// list before this redeem - a successful no-op, not an error.
	AlreadyMember bool
}
