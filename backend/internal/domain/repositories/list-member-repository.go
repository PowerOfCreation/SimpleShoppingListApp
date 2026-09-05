package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type ListMemberRepository interface {
	// ClaimOwnershipIfUnowned atomically adds userID as owner of listID, but
	// only if the list has no members at all yet - the bootstrap for lists
	// that predate the sharing feature, which have no owner recorded
	// anywhere. claimed=false means the list already had members and
	// nothing was written.
	ClaimOwnershipIfUnowned(ctx context.Context, listID uuid.UUID, userID string, now time.Time) (claimed bool, err error)
	// Add inserts member. Idempotent on (list_id, user_id) - redeeming the
	// same invite (or any invite for a list you're already on) twice must
	// not error or duplicate the membership row.
	Add(ctx context.Context, member *entities.ListMember) error
	FindByListAndUser(ctx context.Context, listID uuid.UUID, userID string) (*entities.ListMember, error)
	// FindAccessibleListIDs returns the subset of listIDs userID is a member
	// of - the filter behind every read path. Omission, not an error, is
	// how "not yours" is reported (see GetAccessibleListIDs).
	FindAccessibleListIDs(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// FindClaimedListIDs returns the subset of listIDs that already have at
	// least one member, regardless of who - the pre-check
	// ListAccessService.AuthorizeWrite uses to tell "nobody has pushed to
	// this list yet" apart from "someone else already owns it" before
	// claiming anything, so a batch that's ultimately rejected can't leave
	// a still-unowned list claimed as a side effect.
	FindClaimedListIDs(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// FindListsForUser returns every list userID owns or is a member of -
	// the "restore my lists" discovery read path (sync-sharing-target.md
	// §7.1/§8). Self-scoped by userID, unlike FindAccessibleListIDs there is
	// no candidate list to filter and no enumeration concern.
	FindListsForUser(ctx context.Context, userID string) ([]*entities.ListMember, error)
	// CountByList returns how many members (owner included) listID
	// currently has - used by the invite preview, not an access check.
	CountByList(ctx context.Context, listID uuid.UUID) (int, error)
}
