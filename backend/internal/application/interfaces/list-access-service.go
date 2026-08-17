package interfaces

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrListAccessDenied is returned by ListAccessService when the caller is
// neither a member of an existing list nor eligible to claim it (i.e. the
// list already has members and the caller isn't one). Distinct from
// ErrNotAListMember/ErrNotListOwner (used once membership is already
// established, e.g. by RequireOwner) since this is the first-contact gate
// on /events and /sync/*.
var ErrListAccessDenied = errors.New("caller does not have access to this list")

// ListAccessService is the single place list-level authorization is
// decided (see sync-sharing-target.md §2: access is server-authoritative,
// relational, and synchronously enforced - never a replayable event).
// Every route that touches list content or its event log goes through this
// rather than querying list_members itself.
type ListAccessService interface {
	// AuthorizeWrite claims each of listIDs for userID if it has no members
	// yet (the first push of a new list - see sync-sharing-target.md §3,
	// "Ownership entsteht beim Anlegen"), otherwise requires userID already
	// be a member. Fails closed on the first listID that's neither -
	// ErrListAccessDenied - so a rejected batch enqueues nothing.
	AuthorizeWrite(ctx context.Context, userID string, listIDs []uuid.UUID) error
	// FilterAccessible returns the subset of listIDs userID may read.
	// Never claims - a read must not grant access as a side effect.
	// Silently omitting inaccessible ids, rather than erroring, is what
	// keeps a batch read from being an enumeration oracle ("that id exists
	// but isn't yours" vs. "that id doesn't exist" both come back missing).
	FilterAccessible(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// RequireRead is FilterAccessible for a single list, as an error rather
	// than a filter - for read paths that only ever ask about one list_id
	// (e.g. GET /sync/events), where a 403 is the right response.
	RequireRead(ctx context.Context, userID string, listID uuid.UUID) error
	// RequireOwner requires userID be listID's current owner. Never claims
	// - claiming only ever happens via AuthorizeWrite, on the push path.
	RequireOwner(ctx context.Context, userID string, listID uuid.UUID) error
}
