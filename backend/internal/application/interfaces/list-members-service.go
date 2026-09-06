package interfaces

import (
	"context"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type ListMembersService interface {
	FindMembers(ctx context.Context, userID string, listID uuid.UUID) ([]*entities.UserProfile, error)
}
