package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ListSharingService struct {
	logger    *slog.Logger
	invites   repositories.ListInviteRepository
	members   repositories.ListMemberRepository
	todoLists repositories.ToDoListRepository
}

func NewListSharingService(
	logger *slog.Logger,
	invites repositories.ListInviteRepository,
	members repositories.ListMemberRepository,
	todoLists repositories.ToDoListRepository,
) interfaces.ListSharingService {
	return &ListSharingService{
		logger:    logger,
		invites:   invites,
		members:   members,
		todoLists: todoLists,
	}
}

// claimOrRequireOwner bootstraps the caller as owner if the list has no
// members yet (claim-on-first-invite - the only place ownership is ever
// claimed, so merely listing or revoking invites can't grant it), then
// requires the caller to actually be the owner - sharing (creating invites)
// is an owner-only action, not something any member can do once joined.
func (s *ListSharingService) claimOrRequireOwner(ctx context.Context, listID uuid.UUID, userID string, now time.Time) error {
	claimed, err := s.members.ClaimOwnershipIfUnowned(ctx, listID, userID, now)
	if err != nil {
		return err
	}
	if claimed {
		return nil
	}
	return s.requireOwner(ctx, listID, userID)
}

// requireOwner checks the caller is the list's owner without claiming
// ownership. Distinguishes "not a member at all" from "a member, but not
// the owner" since only the latter is really about the owner-only action
// being attempted.
func (s *ListSharingService) requireOwner(ctx context.Context, listID uuid.UUID, userID string) error {
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

func (s *ListSharingService) requireList(ctx context.Context, listID uuid.UUID) (*entities.ToDoList, error) {
	list, err := s.todoLists.FindById(ctx, listID)
	if err != nil {
		return nil, err
	}
	if list == nil {
		return nil, interfaces.ErrListNotFound
	}
	return list, nil
}

func (s *ListSharingService) CreateInvite(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error) {
	ttl, err := entities.ParseInviteTTL(cmd.TTLKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", interfaces.ErrInvalidInviteTTL, cmd.TTLKey)
	}

	if _, err := s.requireList(ctx, cmd.ListID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if err := s.claimOrRequireOwner(ctx, cmd.ListID, cmd.UserID, now); err != nil {
		return nil, err
	}

	invite, token, err := entities.NewListInvite(cmd.ListID, cmd.UserID, ttl, now)
	if err != nil {
		return nil, err
	}

	if err := s.invites.Create(ctx, invite); err != nil {
		return nil, err
	}

	return &command.CreateListInviteCommandResult{
		Result: mapper.NewListInviteResultFromEntity(invite),
		Token:  string(token),
	}, nil
}

func (s *ListSharingService) FindActiveInvites(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error) {
	if _, err := s.requireList(ctx, qry.ListID); err != nil {
		return nil, err
	}

	// Read-only: must not claim ownership of an unowned list just because
	// someone asked to list its invites.
	if err := s.requireOwner(ctx, qry.ListID, qry.UserID); err != nil {
		return nil, err
	}

	invites, err := s.invites.FindActiveByList(ctx, qry.ListID, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	result := &query.GetListInvitesQueryResult{}
	for _, invite := range invites {
		result.Result = append(result.Result, mapper.NewListInviteResultFromEntity(invite))
	}
	return result, nil
}

func (s *ListSharingService) RevokeInvite(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error) {
	invite, err := s.invites.FindByID(ctx, cmd.InviteID)
	if err != nil {
		return nil, err
	}
	if invite == nil {
		return nil, interfaces.ErrInviteNotFound
	}

	// Only the owner may revoke - and since CreateInvite is now itself
	// owner-only, the creator and the owner are always the same caller, so
	// there's no separate "or the creator" case to check anymore.
	member, err := s.members.FindByListAndUser(ctx, invite.ListID, cmd.UserID)
	if err != nil {
		return nil, err
	}
	if member == nil || member.Role != entities.RoleOwner {
		return nil, interfaces.ErrInviteNotRevocable
	}

	if err := s.invites.Revoke(ctx, cmd.InviteID, time.Now().UTC()); err != nil {
		return nil, err
	}

	return &command.RevokeListInviteCommandResult{}, nil
}

func (s *ListSharingService) RedeemInvite(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error) {
	invite, err := s.invites.FindByTokenHash(ctx, entities.HashInviteToken(cmd.Token))
	if err != nil {
		return nil, err
	}
	if invite == nil {
		return nil, interfaces.ErrInviteNotFound
	}

	// The list may have been deleted since this invite was created; a
	// deleted list can't be joined.
	list, err := s.requireList(ctx, invite.ListID)
	if err != nil {
		return nil, err
	}

	// Idempotency check comes before the revoked/expired check: a caller
	// who already joined must be able to safely retry redeem (e.g. after a
	// lost response) even if the token has since been revoked or expired -
	// at that point it's only re-identifying them, not authorizing a new
	// join. Revocation/expiry only ever blocks *new* joins.
	if existing, err := s.members.FindByListAndUser(ctx, invite.ListID, cmd.UserID); err != nil {
		return nil, err
	} else if existing != nil {
		return &command.RedeemListInviteCommandResult{
			ListID:        invite.ListID,
			ListName:      list.Name,
			Role:          existing.Role,
			AlreadyMember: true,
		}, nil
	}

	now := time.Now().UTC()
	if invite.RevokedAt != nil {
		return nil, interfaces.ErrInviteRevoked
	}
	if !invite.ExpiresAt.After(now) {
		return nil, interfaces.ErrInviteExpired
	}

	inviteID := invite.ID
	member, err := entities.NewListMember(invite.ListID, cmd.UserID, entities.RoleMember, now, &inviteID)
	if err != nil {
		return nil, err
	}
	if err := s.members.Add(ctx, member); err != nil {
		return nil, err
	}

	return &command.RedeemListInviteCommandResult{
		ListID:        invite.ListID,
		ListName:      list.Name,
		Role:          entities.RoleMember,
		AlreadyMember: false,
	}, nil
}
