package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type ListInviteRepository interface {
	Create(ctx context.Context, invite *entities.ListInvite) error
	FindByID(ctx context.Context, id uuid.UUID) (*entities.ListInvite, error)
	FindByTokenHash(ctx context.Context, tokenHash string) (*entities.ListInvite, error)
	// FindActiveByList returns invites for listID that are neither revoked
	// nor expired as of now.
	FindActiveByList(ctx context.Context, listID uuid.UUID, now time.Time) ([]*entities.ListInvite, error)
	// Revoke marks the invite revoked at revokedAt. Idempotent: revoking an
	// already-revoked invite is not an error.
	Revoke(ctx context.Context, id uuid.UUID, revokedAt time.Time) error
}
