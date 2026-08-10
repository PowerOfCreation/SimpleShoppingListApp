package interfaces

import (
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
	ErrInviteNotFound     = errors.New("invite not found")
	ErrInviteExpired      = errors.New("invite has expired")
	ErrInviteRevoked      = errors.New("invite has been revoked")
	ErrInviteNotRevocable = errors.New("caller may not revoke this invite")
)

type ListSharingService interface {
	CreateInvite(cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error)
	FindActiveInvites(qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error)
	RevokeInvite(cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error)
	RedeemInvite(cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error)
}
