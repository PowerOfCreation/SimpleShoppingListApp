package query

import "github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"

type GetMyListsQuery struct {
	// UserID is the caller's verified Keycloak subject - never taken from
	// the request body. Self-scoped, so unlike GetListInvitesQuery there is
	// no ListID to authorize against.
	UserID string
}

type GetMyListsQueryResult struct {
	Result []*common.ListMembershipResult
}
