package interfaces

import (
	"context"
	"errors"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
)

// Sentinel errors ListSharingService returns, so callers (the REST
// controller, in a later PR) can map them to specific HTTP statuses instead
// of collapsing every failure to 500 like the older services in this
// package do.
var (
	ErrListNotFound       = errors.New("todo list not found")
	ErrNotAListMember     = errors.New("caller is not a member of this list")
	ErrInvalidInviteTTL   = errors.New("invalid invite ttl")
	ErrInviteNotFound     = errors.New("invite not found")
	ErrInviteExpired      = errors.New("invite has expired")
	ErrInviteRevoked      = errors.New("invite has been revoked")
	ErrInviteNotRevocable = errors.New("caller may not revoke this invite")
)

type ListSharingService interface {
	CreateInvite(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error)
	FindActiveInvites(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error)
	RevokeInvite(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error)
	RedeemInvite(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error)
}
