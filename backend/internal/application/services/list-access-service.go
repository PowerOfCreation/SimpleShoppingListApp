package services

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ListAccessService struct {
	members repositories.ListMemberRepository
}

func NewListAccessService(members repositories.ListMemberRepository) interfaces.ListAccessService {
	return &ListAccessService{members: members}
}

func (s *ListAccessService) AuthorizeWrite(ctx context.Context, userID string, listIDs []uuid.UUID) error {
	for _, listID := range listIDs {
		if err := s.authorizeOneWrite(ctx, userID, listID); err != nil {
			return err
		}
	}
	return nil
}

// authorizeOneWrite claims listID for userID if it's unowned (the first
// push of a new list), otherwise requires userID already be a member. Two
// round trips (claim, then look up) rather than one - ClaimOwnershipIfUnowned
// only ever bootstraps an *owner*, so a second pushing member still needs
// FindByListAndUser to be recognized.
func (s *ListAccessService) authorizeOneWrite(ctx context.Context, userID string, listID uuid.UUID) error {
	claimed, err := s.members.ClaimOwnershipIfUnowned(ctx, listID, userID, time.Now().UTC())
	if err != nil {
		return err
	}
	if claimed {
		return nil
	}

	member, err := s.members.FindByListAndUser(ctx, listID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return interfaces.ErrListAccessDenied
	}
	return nil
}

func (s *ListAccessService) FilterAccessible(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(listIDs) == 0 {
		return nil, nil
	}
	return s.members.FindAccessibleListIDs(ctx, userID, listIDs)
}

func (s *ListAccessService) RequireRead(ctx context.Context, userID string, listID uuid.UUID) error {
	member, err := s.members.FindByListAndUser(ctx, listID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return interfaces.ErrListAccessDenied
	}
	return nil
}

func (s *ListAccessService) RequireOwner(ctx context.Context, userID string, listID uuid.UUID) error {
	member, err := s.members.FindByListAndUser(ctx, listID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return interfaces.ErrNotAListMember
	}
	if member.Role != entities.RoleOwner {
		return interfaces.ErrNotListOwner
	}
	return nil
}
