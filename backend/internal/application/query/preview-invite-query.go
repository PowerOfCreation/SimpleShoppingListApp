package query

import "github.com/google/uuid"

// PreviewInviteQuery looks an invite up by its plaintext token without
// consuming it - no membership is written, unlike RedeemInvite.
type PreviewInviteQuery struct {
	Token string
}

type PreviewInviteQueryResult struct {
	ListID uuid.UUID
	// ListName is the snapshot captured when the invite was created - see
	// entities.ListInvite.ListName.
	ListName    string
	MemberCount int
	// InvitedByName and InvitedByPictureURL are "" when the inviter's
	// Keycloak profile didn't carry them at invite-creation time.
	InvitedByName       string
	InvitedByPictureURL string
}
