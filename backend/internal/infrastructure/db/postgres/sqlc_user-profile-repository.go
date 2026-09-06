package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

type SqlcUserProfileRepository struct{ queries *db.Queries }

func NewSqlcUserProfileRepository(queries *db.Queries) repositories.UserProfileRepository {
	return &SqlcUserProfileRepository{queries: queries}
}

func (r *SqlcUserProfileRepository) Upsert(ctx context.Context, p *entities.UserProfile) error {
	return r.queries.UpsertUserProfile(ctx, db.UpsertUserProfileParams{UserID: p.UserID(), FirstName: p.FirstName()})
}

func (r *SqlcUserProfileRepository) FindByList(ctx context.Context, listID uuid.UUID) ([]*entities.UserProfile, error) {
	rows, err := r.queries.GetListMemberProfiles(ctx, listID)
	if err != nil {
		return nil, err
	}
	profiles := make([]*entities.UserProfile, 0, len(rows))
	for _, row := range rows {
		profile, err := entities.NewUserProfile(row.UserID, row.FirstName)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}
