package response

import (
	"encoding/json"

	"github.com/google/uuid"
)

// SyncEventResponse deliberately mirrors request.SyncEventRequest's wire
// shape (occurred_at as epoch milliseconds, payload as a raw JSON value,
// list_id nullable) plus a seq - the frontend's WireEvent parses both push
// and pull payloads with the same code path.
type SyncEventResponse struct {
	EventID       uuid.UUID       `json:"event_id"`
	EventType     string          `json:"event_type"`
	AggregateID   uuid.UUID       `json:"aggregate_id"`
	AggregateType string          `json:"aggregate_type"`
	ListID        *uuid.UUID      `json:"list_id"`
	OccurredAt    int64           `json:"occurred_at"`
	ClientID      string          `json:"client_id"`
	Payload       json.RawMessage `json:"payload"`
	Seq           int64           `json:"seq"`
}

// SyncEventsResponse is one page of a list's event history. HasMore is
// true when the page came back full (== the requested limit) - a
// heuristic, not a second count query - so the client knows whether to
// request another page starting at NextSeq.
type SyncEventsResponse struct {
	ListID  uuid.UUID           `json:"list_id"`
	Events  []SyncEventResponse `json:"events"`
	NextSeq int64               `json:"next_seq"`
	HasMore bool                `json:"has_more"`
}
