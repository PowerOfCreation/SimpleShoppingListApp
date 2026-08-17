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
	// UserID is the verified Keycloak sub of whoever pushed this event, set
	// by the push handler (which still has the request context) - never by
	// the async EventIngestor worker, which doesn't (see
	// sync-sharing-target.md 7.1). Empty for events accepted before access
	// enforcement existed; those get no owner and stay outside every
	// list_members-based check (see migration 00007).
	UserID string
	// Seq is the pull cursor position, assigned by Insert as soon as the
	// event is durably received - independent of whether its projection
	// ever succeeds (see EventIngestor). Zero on an event that hasn't been
	// inserted yet; every StoredEvent read back from the repository
	// (FindUnprocessed, FindEventsSince, or Insert's own return) has it set.
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
	// Insert durably stores the event and assigns it its seq (idempotent on
	// EventID - a duplicate delivery keeps its original seq rather than
	// getting a new one). Returns alreadyProcessed=true if this exact
	// event_id had already finished processing on a previous delivery - the
	// caller must not dispatch it again in that case, only ack it (using
	// the returned seq/listID). Returns alreadyProcessed=false for a
	// brand-new event (apply it), which is also the only way an
	// existing-but-still-unprocessed row is reported - see EventIngestor
	// for why that combination can't otherwise arise.
	Insert(ctx context.Context, event *StoredEvent) (alreadyProcessed bool, seq int64, listID *uuid.UUID, err error)
	// MarkProcessed marks the event's projection attempt as finished. Does
	// not touch seq - that was already assigned by Insert. Safe to call
	// more than once for the same event_id (a genuine no-op past the first
	// call): the periodic sweep can legitimately race a live dispatch that
	// just finished the same row.
	MarkProcessed(ctx context.Context, eventID uuid.UUID) error
	// FindUnprocessed returns events that were durably inserted but never
	// finished processing - e.g. a transient handler error, or the process
	// crashed between Insert and the dispatch+MarkProcessed step. Ordered
	// by seq so a sweep replays them in the order they were durably
	// received, never out of position relative to an event that arrived
	// after them.
	FindUnprocessed(ctx context.Context) ([]*StoredEvent, error)
	// FindKnownEventIDsByList returns which of the given lists' events this
	// server has durably received - used by the /sync/state reconcile
	// endpoint. Keyed by list_id rather than aggregate_id: once
	// ingredient.* events became syncable, aggregate_id stopped being a
	// usable key (it's the ingredient id, not the list), so a client would
	// have to enumerate every ingredient id in a list instead of the one
	// list_id it already has.
	FindKnownEventIDsByList(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// FindListHeads returns the current pull cursor for every requested
	// list that has at least one durably received event. Lists with none
	// are simply omitted - callers fill in the zero-value head themselves
	// so every requested id still appears in a response.
	FindListHeads(ctx context.Context, listIDs []uuid.UUID) ([]*ListHead, error)
	// FindEventsSince returns up to limit events for one list, strictly
	// ordered by seq, whose seq is greater than sinceSeq - the pull
	// endpoint's core page query.
	FindEventsSince(ctx context.Context, listID uuid.UUID, sinceSeq int64, limit int32) ([]*StoredEvent, error)
}
