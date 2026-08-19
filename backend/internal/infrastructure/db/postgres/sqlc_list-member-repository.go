package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

type SqlcListMemberRepository struct {
	queries *db.Queries
}

func NewSqlcListMemberRepository(queries *db.Queries) repositories.ListMemberRepository {
	return &SqlcListMemberRepository{queries: queries}
}

func (r *SqlcListMemberRepository) ClaimOwnershipIfUnowned(
	ctx context.Context,
	listID uuid.UUID,
	userID string,
	now time.Time,
) (bool, error) {
	_, err := r.queries.ClaimListOwnership(ctx, db.ClaimListOwnershipParams{
		ListID:   listID,
		UserID:   userID,
		JoinedAt: timestamptzFromTime(now),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The list already had members - nothing was written.
			return false, nil
		}
		// A 23505 here can only come from idx_list_members_single_owner (a
		// concurrent claim won the race between our NOT EXISTS check and
		// our INSERT) or the list_members PK (we raced ourselves). Both
		// mean "lost the race, nothing was written" - same as ErrNoRows -
		// and the caller (claimNewList) already falls back to checking its
		// own membership, so there's nothing more to do here than report it.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *SqlcListMemberRepository) Add(ctx context.Context, member *entities.ListMember) error {
	return r.queries.AddListMember(ctx, db.AddListMemberParams{
		ListID:   member.ListID,
		UserID:   member.UserID,
		Role:     string(member.Role),
		JoinedAt: timestamptzFromTime(member.JoinedAt),
		InviteID: pgtypeFromUUIDPtr(member.InviteID),
	})
}

func (r *SqlcListMemberRepository) FindByListAndUser(
	ctx context.Context,
	listID uuid.UUID,
	userID string,
) (*entities.ListMember, error) {
	row, err := r.queries.GetListMember(ctx, db.GetListMemberParams{ListID: listID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	// Goes through the validating constructor rather than a struct literal
	// so a row that shouldn't exist (e.g. a role value the domain doesn't
	// recognize, from a hand-edited row or a future buggy migration) is
	// reported as an error instead of silently handed to callers as a
	// ListMember they can't trust.
	member, err := entities.NewListMember(
		row.ListID,
		row.UserID,
		entities.ListMemberRole(row.Role),
		timeFromTimestamptz(row.JoinedAt),
		uuidPtrFromPgtype(row.InviteID),
	)
	if err != nil {
		return nil, fmt.Errorf("corrupt list_members row (list_id=%s, user_id=%s): %w", row.ListID, row.UserID, err)
	}
	return member, nil
}

func (r *SqlcListMemberRepository) FindAccessibleListIDs(
	ctx context.Context,
	userID string,
	listIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	if len(listIDs) == 0 {
		return nil, nil
	}
	return r.queries.GetAccessibleListIDs(ctx, db.GetAccessibleListIDsParams{
		ListIds: listIDs,
		UserID:  userID,
	})
}

func (r *SqlcListMemberRepository) FindClaimedListIDs(
	ctx context.Context,
	listIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	if len(listIDs) == 0 {
		return nil, nil
	}
	return r.queries.GetClaimedListIDs(ctx, listIDs)
}
