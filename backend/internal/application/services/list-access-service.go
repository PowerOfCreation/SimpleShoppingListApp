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

// AuthorizeWrite runs in two phases so a batch that ends up rejected can't
// leave a still-unowned list claimed as a side effect (see
// sync-sharing-target.md 7.1 / the PR #249 review): first find out, for
// every listID, whether the batch can succeed at all - without claiming
// anything - then only claim the ones that turned out to genuinely be
// nobody's yet. The common case (an existing member pushing to lists they
// already belong to) never reaches the claim phase at all, so it's a pure
// read rather than an INSERT ... WHERE NOT EXISTS on every push.
func (s *ListAccessService) AuthorizeWrite(ctx context.Context, userID string, listIDs []uuid.UUID) error {
	if len(listIDs) == 0 {
		return nil
	}

	accessible, err := s.members.FindAccessibleListIDs(ctx, userID, listIDs)
	if err != nil {
		return err
	}
	unresolved := subtract(listIDs, accessible)
	if len(unresolved) == 0 {
		return nil
	}

	// Of the lists userID isn't already a member of, any that already have
	// *some* member belong to someone else - claiming never applies to
	// them, and the whole batch fails closed before any claim is attempted.
	claimedByOthers, err := s.members.FindClaimedListIDs(ctx, unresolved)
	if err != nil {
		return err
	}
	if len(claimedByOthers) > 0 {
		return interfaces.ErrListAccessDenied
	}

	for _, listID := range unresolved {
		if err := s.claimNewList(ctx, userID, listID); err != nil {
			return err
		}
	}
	return nil
}

// claimNewList bootstraps userID as owner of a listID already confirmed to
// have no members at all. Falls back to a membership check rather than
// failing outright if the claim itself reports it lost a race (someone
// else's concurrent push claimed listID between the pre-check and here).
func (s *ListAccessService) claimNewList(ctx context.Context, userID string, listID uuid.UUID) error {
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

// subtract returns the ids in all that aren't in exclude.
func subtract(all, exclude []uuid.UUID) []uuid.UUID {
	if len(exclude) == 0 {
		return all
	}
	skip := make(map[uuid.UUID]struct{}, len(exclude))
	for _, id := range exclude {
		skip[id] = struct{}{}
	}
	remaining := make([]uuid.UUID, 0, len(all))
	for _, id := range all {
		if _, ok := skip[id]; !ok {
			remaining = append(remaining, id)
		}
	}
	return remaining
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
