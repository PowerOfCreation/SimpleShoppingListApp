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

type SqlcListInviteRepository struct {
	queries *db.Queries
}

func NewSqlcListInviteRepository(queries *db.Queries) repositories.ListInviteRepository {
	return &SqlcListInviteRepository{queries: queries}
}

func (r *SqlcListInviteRepository) Create(ctx context.Context, invite *entities.ListInvite) error {
	return r.queries.InsertListInvite(ctx, db.InsertListInviteParams{
		ID:                  invite.ID,
		ListID:              invite.ListID,
		TokenHash:           invite.TokenHash,
		CreatedBy:           invite.CreatedBy,
		CreatedAt:           timestamptzFromTime(invite.CreatedAt),
		ExpiresAt:           timestamptzFromTime(invite.ExpiresAt),
		ListName:            invite.ListName,
		CreatedByName:       pgtypeTextFromString(invite.CreatedByName),
		CreatedByPictureUrl: pgtypeTextFromString(invite.CreatedByPictureURL),
	})
}

func (r *SqlcListInviteRepository) FindByID(ctx context.Context, id uuid.UUID) (*entities.ListInvite, error) {
	row, err := r.queries.GetListInviteById(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return fromSqlcListInviteRow(&row), nil
}

func (r *SqlcListInviteRepository) FindByTokenHash(ctx context.Context, tokenHash string) (*entities.ListInvite, error) {
	row, err := r.queries.GetListInviteByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return fromSqlcListInviteRow(&row), nil
}

func (r *SqlcListInviteRepository) FindActiveByList(
	ctx context.Context,
	listID uuid.UUID,
	now time.Time,
) ([]*entities.ListInvite, error) {
	rows, err := r.queries.GetActiveListInvites(ctx, db.GetActiveListInvitesParams{
		ListID: listID,
		Now:    timestamptzFromTime(now),
	})
	if err != nil {
		return nil, err
	}

	invites := make([]*entities.ListInvite, len(rows))
	for i, row := range rows {
		invites[i] = fromSqlcListInviteRow(&row)
	}
	return invites, nil
}

func (r *SqlcListInviteRepository) Revoke(ctx context.Context, id uuid.UUID, revokedAt time.Time) error {
	return r.queries.RevokeListInvite(ctx, db.RevokeListInviteParams{
		ID:        id,
		RevokedAt: timestamptzFromTime(revokedAt),
	})
}

func fromSqlcListInviteRow(row *db.ListInvite) *entities.ListInvite {
	return &entities.ListInvite{
		ID:                  row.ID,
		ListID:              row.ListID,
		TokenHash:           row.TokenHash,
		CreatedBy:           row.CreatedBy,
		CreatedAt:           timeFromTimestamptz(row.CreatedAt),
		ExpiresAt:           timeFromTimestamptz(row.ExpiresAt),
		RevokedAt:           timePtrFromTimestamptz(row.RevokedAt),
		ListName:            row.ListName,
		CreatedByName:       stringFromPgtypeText(row.CreatedByName),
		CreatedByPictureURL: stringFromPgtypeText(row.CreatedByPictureUrl),
	}
}
