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
	// Seq is the pull cursor position, assigned by MarkProcessed. Zero
	// until then - only meaningful once processed (which, by construction,
	// StoredEvent instances read back via FindEventsSince/pull always are).
	Seq int64
}

// ListHead is a list's current pull cursor: the seq and id of the most
// recently processed event belonging to it. Returned by FindListHeads.
type ListHead struct {
	ListID  uuid.UUID
	Seq     int64
	EventID uuid.UUID
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
	// MarkProcessed marks the event durably processed and assigns it the
	// next value from the shared seq sequence, returning that seq and the
	// event's list_id - handing the list_id back here saves a caller
	// (EventIngestor, to publish a list-scoped WebSocket notification) a
	// second read. Must only ever be called once per event_id - see the
	// seq-assignment comment on MarkEventProcessed in sql/queries/events.sql
	// for why a second call is a bug, not a race, given the ingestor's
	// single-writer guarantee.
	MarkProcessed(ctx context.Context, eventID uuid.UUID) (seq int64, listID *uuid.UUID, err error)
	// FindUnprocessed returns events that were durably inserted but never
	// finished processing - e.g. the process crashed between Insert and
	// the dispatch+MarkProcessed step. Ordered by arrival so a startup
	// sweep replays them in the order they were originally received.
	FindUnprocessed(ctx context.Context) ([]*StoredEvent, error)
	// FindKnownEventIDsByList returns which of the given lists' events
	// this server has durably processed - used by the /sync/state
	// reconcile endpoint. Keyed by list_id rather than aggregate_id: once
	// ingredient.* events became syncable, aggregate_id stopped being a
	// usable key (it's the ingredient id, not the list), so a client would
	// have to enumerate every ingredient id in a list instead of the one
	// list_id it already has.
	FindKnownEventIDsByList(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// FindListHeads returns the current pull cursor for every requested
	// list that has at least one durably processed event. Lists with none
	// are simply omitted - callers fill in the zero-value head themselves
	// so every requested id still appears in a response.
	FindListHeads(ctx context.Context, listIDs []uuid.UUID) ([]*ListHead, error)
	// FindEventsSince returns up to limit events for one list, strictly
	// ordered by seq, whose seq is greater than sinceSeq - the pull
	// endpoint's core page query.
	FindEventsSince(ctx context.Context, listID uuid.UUID, sinceSeq int64, limit int32) ([]*StoredEvent, error)
}
