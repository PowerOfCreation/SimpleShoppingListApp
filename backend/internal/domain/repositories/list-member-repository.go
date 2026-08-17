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
}
