package repositories

import (
	"context"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type UserProfileRepository interface {
	Upsert(ctx context.Context, profile *entities.UserProfile) error
	FindByList(ctx context.Context, listID uuid.UUID) ([]*entities.UserProfile, error)
}
