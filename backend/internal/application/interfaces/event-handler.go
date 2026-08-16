package interfaces

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type EventHandler interface {
	EventType() string
	Handle(ctx context.Context, aggregateID uuid.UUID, occurredAt time.Time, payload json.RawMessage) error
}
