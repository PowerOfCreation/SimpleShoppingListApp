package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

type SqlcSyncedListRepository struct {
	queries *db.Queries
}

func NewSqlcSyncedListRepository(queries *db.Queries) repositories.SyncedListRepository {
	return &SqlcSyncedListRepository{queries: queries}
}

// Registry rows are written by ClaimListOwnership, alongside the owner row
// in one statement - there is deliberately no Create here, so a list can't
// become known to the server without also becoming owned. The one exception
// is the 00008 backfill, which seeded synced_lists for lists that predate
// the registry and may have no owner membership.
func (r *SqlcSyncedListRepository) Exists(ctx context.Context, listID uuid.UUID) (bool, error) {
	return r.queries.SyncedListExists(ctx, listID)
}
