package interfaces

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

type EventHandler interface {
	EventType() string
	Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error
}
