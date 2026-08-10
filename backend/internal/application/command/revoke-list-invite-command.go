package command

import "github.com/google/uuid"

type RevokeListInviteCommand struct {
	InviteID uuid.UUID
	// UserID is the caller's verified Keycloak subject - never taken from
	// the request body.
	UserID string
}

type RevokeListInviteCommandResult struct{}
