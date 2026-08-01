package events

import (
	"time"

	"github.com/google/uuid"
)

type DomainEvent struct {
	EventID       uuid.UUID `json:"event_id"`
	EventType     string    `json:"event_type"`
	AggregateID   uuid.UUID `json:"aggregate_id"`
	AggregateType string    `json:"aggregate_type"`
	OccurredAt    time.Time `json:"occurred_at"`
	ClientID      string    `json:"client_id"`
}
