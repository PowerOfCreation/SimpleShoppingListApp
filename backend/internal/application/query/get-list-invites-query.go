package query

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type GetListInvitesQuery struct {
	ListID uuid.UUID
	// UserID is the caller's verified Keycloak subject - never taken from
	// the request body.
	UserID string
}

type GetListInvitesQueryResult struct {
	Result []*common.ListInviteResult
}
