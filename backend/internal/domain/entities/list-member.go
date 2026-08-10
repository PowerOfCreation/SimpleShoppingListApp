package entities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type ListMemberRole string

const (
	RoleOwner  ListMemberRole = "owner"
	RoleMember ListMemberRole = "member"
)

// ListMember is one user's membership on one list. InviteID is nil for the
// owner created via claim-on-first-invite (there was no invite to redeem);
// it's set for anyone who joined by redeeming a ListInvite.
type ListMember struct {
	ListID   uuid.UUID
	UserID   string
	Role     ListMemberRole
	JoinedAt time.Time
	InviteID *uuid.UUID
}

func (m *ListMember) validate() error {
	if m.ListID == uuid.Nil {
		return errors.New("list id must not be empty")
	}
	if m.UserID == "" {
		return errors.New("user id must not be empty")
	}
	if m.Role != RoleOwner && m.Role != RoleMember {
		return errors.New("role must be owner or member")
	}
	return nil
}

func NewListMember(listID uuid.UUID, userID string, role ListMemberRole, joinedAt time.Time, inviteID *uuid.UUID) (*ListMember, error) {
	member := &ListMember{
		ListID:   listID,
		UserID:   userID,
		Role:     role,
		JoinedAt: joinedAt,
		InviteID: inviteID,
	}
	if err := member.validate(); err != nil {
		return nil, err
	}
	return member, nil
}
