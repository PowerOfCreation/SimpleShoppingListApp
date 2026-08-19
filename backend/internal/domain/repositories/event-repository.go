package repositories

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// StoredEvent is the durable representation of a synced domain event -
// enough to relay it to another client without going back to the sender.
type StoredEvent struct {
	EventID       uuid.UUID
	EventType     string
	AggregateID   uuid.UUID
	AggregateType string
	// ListID groups the event by the list it belongs to, for list-scoped
	// pull/reconcile. Equal to AggregateID for todo_list.* events; for
	// ingredient.* events it's the parent list, resolved client-side (the
	// ingredient's own aggregate_id isn't the list). Nil only for rows that
	// predate list scoping (older stored data) - every event AppendToList
	// accepts today carries one, enforced by the push handler.
	ListID     *uuid.UUID
	Payload    json.RawMessage
	OccurredAt time.Time
	ClientID   string
	// UserID is the verified Keycloak sub of whoever pushed this event, set
	// by the push handler (which has the request context) - see
	// sync-sharing-target.md 7.1. Empty for events accepted before access
	// enforcement existed; those get no owner and stay outside every
	// list_members-based check (see migration 00007).
	UserID string
	// Seq is the pull cursor position within this event's list, assigned by
	// AppendToList. Zero until AppendToList sets it; every StoredEvent read
	// back from the repository (FindEventsSince, or AppendToList's own
	// mutation) has it set.
	Seq int64
}

// ListHead is a list's current pull cursor: the seq and id of the most
// recently appended event belonging to it. Returned by FindListHeads.
// EventID is nil for a list the registry knows about but that has no
// events yet (head_seq 0).
type ListHead struct {
	ListID  uuid.UUID
	Seq     int64
	EventID *uuid.UUID
}

type EventRepository interface {
	// AppendToList durably appends events - already known to all belong to
	// listID - to that list's log, inside a single transaction: it row-locks
	// (creating if missing - see LockOrCreateSyncedList) the list's registry
	// entry, assigns each new event's seq from that row's head_seq in order
	// (a duplicate delivery, identified by event_id, keeps its original seq
	// and does not consume a fresh one), advances head_seq to match, and
	// mutates each event's Seq field in place. The row lock is what makes
	// this safe across multiple API replicas, replacing the old
	// single-EventIngestor-process invariant (see
	// frontend/docs/sync-server-registry-roadmap.md).
	//
	// Returns the list's resulting head_seq (always >= every event's Seq
	// above, even if this call's events were all duplicates) and whether at
	// least one event was newly appended - the caller's signal for whether a
	// ListEventPublisher notification is warranted at all.
	AppendToList(ctx context.Context, listID uuid.UUID, events []*StoredEvent, now time.Time) (headSeq int64, appended bool, err error)
	// FindKnownEventIDsByList returns which of the given lists' events this
	// server has durably received - used by the /sync/state reconcile
	// endpoint. Keyed by list_id rather than aggregate_id: once
	// ingredient.* events became syncable, aggregate_id stopped being a
	// usable key (it's the ingredient id, not the list), so a client would
	// have to enumerate every ingredient id in a list instead of the one
	// list_id it already has.
	FindKnownEventIDsByList(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error)
	// FindListHeads returns the current pull cursor for every requested list
	// the registry has a row for. A list the registry doesn't know at all is
	// simply omitted - callers fill in the zero-value head themselves so
	// every requested id still appears in a response.
	FindListHeads(ctx context.Context, listIDs []uuid.UUID) ([]*ListHead, error)
	// FindEventsSince returns up to limit events for one list, strictly
	// ordered by seq, whose seq is greater than sinceSeq - the pull
	// endpoint's core page query.
	FindEventsSince(ctx context.Context, listID uuid.UUID, sinceSeq int64, limit int32) ([]*StoredEvent, error)
}
