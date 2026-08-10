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

// claimOrRequireMember bootstraps the caller as owner if the list has no
// members yet (claim-on-first-invite - the only place ownership is ever
// claimed, so merely listing or revoking invites can't grant it), then
// requires the caller to actually be a member.
func (s *ListSharingService) claimOrRequireMember(ctx context.Context, listID uuid.UUID, userID string, now time.Time) error {
	if _, err := s.members.ClaimOwnershipIfUnowned(ctx, listID, userID, now); err != nil {
		return err
	}
	return s.requireMember(ctx, listID, userID)
}

// requireMember checks existing membership without claiming ownership.
func (s *ListSharingService) requireMember(ctx context.Context, listID uuid.UUID, userID string) error {
	member, err := s.members.FindByListAndUser(ctx, listID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return interfaces.ErrNotAListMember
	}
	return nil
}

func (s *ListSharingService) requireList(listID uuid.UUID) (*entities.ToDoList, error) {
	list, err := s.todoLists.FindById(listID)
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

	if _, err := s.requireList(cmd.ListID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	if err := s.claimOrRequireMember(ctx, cmd.ListID, cmd.UserID, now); err != nil {
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
	if _, err := s.requireList(qry.ListID); err != nil {
		return nil, err
	}

	// Read-only: must not claim ownership of an unowned list just because
	// someone asked to list its invites.
	if err := s.requireMember(ctx, qry.ListID, qry.UserID); err != nil {
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

	if invite.CreatedBy != cmd.UserID {
		member, err := s.members.FindByListAndUser(ctx, invite.ListID, cmd.UserID)
		if err != nil {
			return nil, err
		}
		if member == nil || member.Role != entities.RoleOwner {
			return nil, interfaces.ErrInviteNotRevocable
		}
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

	now := time.Now().UTC()
	if invite.RevokedAt != nil {
		return nil, interfaces.ErrInviteRevoked
	}
	if !invite.ExpiresAt.After(now) {
		return nil, interfaces.ErrInviteExpired
	}

	// The list may have been deleted since this invite was created; a
	// deleted list can't be joined.
	list, err := s.requireList(invite.ListID)
	if err != nil {
		return nil, err
	}

	existing, err := s.members.FindByListAndUser(ctx, invite.ListID, cmd.UserID)
	if err != nil {
		return nil, err
	}

	role := entities.RoleMember
	alreadyMember := existing != nil
	if alreadyMember {
		role = existing.Role
	} else {
		inviteID := invite.ID
		member, err := entities.NewListMember(invite.ListID, cmd.UserID, entities.RoleMember, now, &inviteID)
		if err != nil {
			return nil, err
		}
		if err := s.members.Add(ctx, member); err != nil {
			return nil, err
		}
	}

	return &command.RedeemListInviteCommandResult{
		ListID:        invite.ListID,
		ListName:      list.Name,
		Role:          role,
		AlreadyMember: alreadyMember,
	}, nil
}
