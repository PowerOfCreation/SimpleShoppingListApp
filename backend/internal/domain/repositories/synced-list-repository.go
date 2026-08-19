package repositories

import (
	"context"

	"github.com/google/uuid"
)

// SyncedListRepository answers whether the server holds a log for a list.
// It deliberately exposes no way to read list content: the registry stores
// none, and "does this list exist" is the only question the server needs to
// answer about it (R3 in frontend/docs/sync-sharing-target.md).
type SyncedListRepository interface {
	Exists(ctx context.Context, listID uuid.UUID) (bool, error)
}
