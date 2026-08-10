package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

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

	return &entities.ListMember{
		ListID:   row.ListID,
		UserID:   row.UserID,
		Role:     entities.ListMemberRole(row.Role),
		JoinedAt: timeFromTimestamptz(row.JoinedAt),
		InviteID: uuidPtrFromPgtype(row.InviteID),
	}, nil
}
