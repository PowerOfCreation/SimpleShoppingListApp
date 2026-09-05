package mapper

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

func ToCreateListInviteResponse(result *command.CreateListInviteCommandResult) response.CreateListInviteResponse {
	return response.CreateListInviteResponse{
		InviteID:  result.Result.ID,
		ListID:    result.Result.ListID,
		Token:     result.Token,
		ExpiresAt: result.Result.ExpiresAt,
		CreatedAt: result.Result.CreatedAt,
	}
}

func ToListInviteResponse(invite *common.ListInviteResult) response.ListInviteResponse {
	return response.ListInviteResponse{
		InviteID:  invite.ID,
		CreatedBy: invite.CreatedBy,
		CreatedAt: invite.CreatedAt,
		ExpiresAt: invite.ExpiresAt,
	}
}

// ToListInviteResponseList always returns a non-nil slice, so an empty
// result serializes as [] rather than null.
func ToListInviteResponseList(invites []*common.ListInviteResult) []response.ListInviteResponse {
	responses := make([]response.ListInviteResponse, len(invites))
	for i, invite := range invites {
		responses[i] = ToListInviteResponse(invite)
	}
	return responses
}

func ToRedeemListInviteResponse(result *command.RedeemListInviteCommandResult) response.RedeemListInviteResponse {
	return response.RedeemListInviteResponse{
		ListID:              result.ListID,
		Role:                string(result.Role),
		AlreadyMember:       result.AlreadyMember,
		ListName:            result.ListName,
		MemberCount:         result.MemberCount,
		InvitedByName:       stringPtrOrNil(result.InvitedByName),
		InvitedByPictureURL: stringPtrOrNil(result.InvitedByPictureURL),
	}
}

func ToInvitePreviewResponse(result *query.PreviewInviteQueryResult) response.InvitePreviewResponse {
	return response.InvitePreviewResponse{
		ListID:              result.ListID,
		ListName:            result.ListName,
		MemberCount:         result.MemberCount,
		InvitedByName:       stringPtrOrNil(result.InvitedByName),
		InvitedByPictureURL: stringPtrOrNil(result.InvitedByPictureURL),
	}
}

// stringPtrOrNil serializes an absent profile claim as JSON null rather
// than "".
func stringPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ToMyListsResponse always returns a non-nil Lists slice, so no memberships
// serializes as [] rather than null.
func ToMyListsResponse(result *query.GetMyListsQueryResult) response.MyListsResponse {
	lists := make([]response.ListMembershipResponse, len(result.Result))
	for i, membership := range result.Result {
		lists[i] = response.ListMembershipResponse{
			ListID: membership.ListID,
			Role:   membership.Role,
		}
	}
	return response.MyListsResponse{Lists: lists}
}
