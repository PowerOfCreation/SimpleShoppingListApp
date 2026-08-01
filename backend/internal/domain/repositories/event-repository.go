package repositories

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// StoredEvent is the durable representation of a synced domain event -
// enough to (re-)dispatch it without going back to the client. Used both
// for freshly-received events and for the unprocessed-events sweep on
// startup.
type StoredEvent struct {
	EventID       uuid.UUID
	EventType     string
	AggregateID   uuid.UUID
	AggregateType string
	// ListID groups the event by the list it belongs to, for list-scoped
	// pull/reconcile. Equal to AggregateID for todo_list.* events; for
	// ingredient.* events it's the parent list, resolved client-side (the
	// ingredient's own aggregate_id isn't the list). Nil when the sending
	// client didn't populate it (older builds) or it couldn't be resolved.
	ListID     *uuid.UUID
	Payload    json.RawMessage
	OccurredAt time.Time
	ClientID   string
}

type EventRepository interface {
	// Insert durably stores the event (idempotent on EventID). Returns
	// alreadyProcessed=true if this exact event_id had already finished
	// processing on a previous delivery - the caller must not dispatch it
	// again in that case, only ack it. Returns alreadyProcessed=false for
	// a brand-new event (dispatch it), which is also the only way an
	// existing-but-still-unprocessed row is reported - see
	// EventIngestor for why that combination can't otherwise arise.
	Insert(ctx context.Context, event *StoredEvent) (alreadyProcessed bool, err error)
	MarkProcessed(ctx context.Context, eventID uuid.UUID) error
	// FindUnprocessed returns events that were durably inserted but never
	// finished processing - e.g. the process crashed between Insert and
	// the dispatch+MarkProcessed step. Ordered by arrival so a startup
	// sweep replays them in the order they were originally received.
	FindUnprocessed(ctx context.Context) ([]*StoredEvent, error)
	// FindKnownEventIDs returns which of the given aggregates' events this
	// server has durably processed - used by the /sync/state reconcile
	// endpoint.
	FindKnownEventIDs(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error)
}
