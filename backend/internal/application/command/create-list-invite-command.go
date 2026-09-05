package command

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type CreateListInviteCommand struct {
	ListID uuid.UUID
	// UserID is the caller's verified Keycloak subject - never taken from
	// the request body, see sync-design-decisions.md.
	UserID string
	TTLKey string
	// ListName is the client-supplied snapshot of the list's current name -
	// see entities.ListInvite.ListName.
	ListName string
	// CreatedByName and CreatedByPictureURL are the caller's own profile
	// claims, read from their verified JWT (middleware.UserProfileFromContext)
	// - never taken from the request body.
	CreatedByName       string
	CreatedByPictureURL string
}

type CreateListInviteCommandResult struct {
	Result *common.ListInviteResult
	// Token is the plaintext invite token - present only in this, the
	// create result. Never persisted, never returned again afterwards.
	Token string
}
