package request

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type SyncEventRequest struct {
	EventID       uuid.UUID `json:"event_id"`
	EventType     string    `json:"event_type"`
	AggregateID   uuid.UUID `json:"aggregate_id"`
	AggregateType string    `json:"aggregate_type"`
	// Pointer (not uuid.UUID) so older clients that don't send list_id yet
	// still bind successfully instead of failing to parse - it's simply
	// nil, matching repositories.StoredEvent.ListID.
	ListID *uuid.UUID `json:"list_id"`
	// Epoch milliseconds, matching how the frontend stores and sends
	// occurred_at (a plain JS Date.now() number) - not time.Time, which
	// would fail to bind against a JSON number.
	OccurredAt int64           `json:"occurred_at"`
	ClientID   string          `json:"client_id"`
	Payload    json.RawMessage `json:"payload"`
}

// ToStoredEvent takes userID as a parameter rather than reading it off the
// request - it must be the verified Keycloak sub the push handler read from
// the auth middleware, never a client-supplied field (there is no
// user_id/sub in the wire shape above for exactly that reason).
func (req *SyncEventRequest) ToStoredEvent(userID string) *repositories.StoredEvent {
	return &repositories.StoredEvent{
		EventID:       req.EventID,
		EventType:     req.EventType,
		AggregateID:   req.AggregateID,
		AggregateType: req.AggregateType,
		ListID:        req.ListID,
		Payload:       req.Payload,
		OccurredAt:    time.UnixMilli(req.OccurredAt).UTC(),
		ClientID:      req.ClientID,
		UserID:        userID,
	}
}
