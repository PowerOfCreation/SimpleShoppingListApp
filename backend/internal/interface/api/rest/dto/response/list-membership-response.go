package response

import "github.com/google/uuid"

// ListMembershipResponse is one list the caller owns or is a member of - no
// list name, see ListMembershipResult.
type ListMembershipResponse struct {
	ListID uuid.UUID `json:"list_id"`
	Role   string    `json:"role"`
}

type MyListsResponse struct {
	Lists []ListMembershipResponse `json:"lists"`
}
