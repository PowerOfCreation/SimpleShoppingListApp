package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ListSharingService struct {
	logger  *slog.Logger
	invites repositories.ListInviteRepository
	members repositories.ListMemberRepository
	lists   repositories.SyncedListRepository
	access  interfaces.ListAccessService
}

func NewListSharingService(
	logger *slog.Logger,
	invites repositories.ListInviteRepository,
	members repositories.ListMemberRepository,
	lists repositories.SyncedListRepository,
	access interfaces.ListAccessService,
) interfaces.ListSharingService {
	return &ListSharingService{
		logger:  logger,
		invites: invites,
		members: members,
		lists:   lists,
		access:  access,
	}
}

// requireList asks the registry, not a content projection: "synchronized"
// means the server holds a log for this list, nothing more. It returns no
// entity because there is none to return - the server has no list content.
func (s *ListSharingService) requireList(ctx context.Context, listID uuid.UUID) error {
	exists, err := s.lists.Exists(ctx, listID)
	if err != nil {
		return err
	}
	if !exists {
		return interfaces.ErrListNotFound
	}
	return nil
}

func (s *ListSharingService) CreateInvite(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error) {
	ttl, err := entities.ParseInviteTTL(cmd.TTLKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", interfaces.ErrInvalidInviteTTL, cmd.TTLKey)
	}

	if err := s.requireList(ctx, cmd.ListID); err != nil {
		return nil, err
	}

	// Ownership is claimed on the first push of a new list (see
	// ListAccessService.AuthorizeWrite), never here - sharing is an
	// owner-only action, not a way to become owner.
	if err := s.access.RequireOwner(ctx, cmd.UserID, cmd.ListID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
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
	if err := s.requireList(ctx, qry.ListID); err != nil {
		return nil, err
	}

	// Read-only: must not claim ownership of an unowned list just because
	// someone asked to list its invites.
	if err := s.access.RequireOwner(ctx, qry.UserID, qry.ListID); err != nil {
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

	// Only that the server still holds a log for this list. Whether that log
	// ends in todo_list.deleted is not something the server can know - it
	// doesn't read payloads - so redeeming an invite to an already-deleted
	// list succeeds here and the client discovers the deletion on its first
	// pull, when it rebuilds the list from full history.
	if err := s.requireList(ctx, invite.ListID); err != nil {
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
		Role:          entities.RoleMember,
		AlreadyMember: false,
	}, nil
}

// FindMyLists is self-scoped by the caller's own verified UserID, unlike
// every other method here - there is no listID to check requireList/
// RequireOwner against, and none is needed: a user is always allowed to
// know their own memberships.
func (s *ListSharingService) FindMyLists(ctx context.Context, qry *query.GetMyListsQuery) (*query.GetMyListsQueryResult, error) {
	members, err := s.members.FindListsForUser(ctx, qry.UserID)
	if err != nil {
		return nil, err
	}

	result := &query.GetMyListsQueryResult{}
	for _, member := range members {
		result.Result = append(result.Result, &common.ListMembershipResult{
			ListID:   member.ListID,
			Role:     string(member.Role),
			JoinedAt: member.JoinedAt,
		})
	}
	return result, nil
}
