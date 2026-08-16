package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
)

type EventDispatcher struct {
	logger   *slog.Logger
	handlers map[string]interfaces.EventHandler
}

func NewEventDispatcher(logger *slog.Logger, handlers ...interfaces.EventHandler) *EventDispatcher {
	m := make(map[string]interfaces.EventHandler, len(handlers))
	for _, h := range handlers {
		m[h.EventType()] = h
	}
	return &EventDispatcher{logger: logger, handlers: m}
}

// Dispatch routes a single event to its handler. Unknown event types are silently
// ignored so the backend stays forward-compatible with events from newer clients -
// but logged, since it also signals client/server version skew worth knowing about.
func (d *EventDispatcher) Dispatch(ctx context.Context, eventType string, aggregateID uuid.UUID, occurredAt time.Time, payload json.RawMessage) error {
	handler, ok := d.handlers[eventType]
	if !ok {
		d.logger.Warn("unknown event type", "event_type", eventType, "aggregate_id", aggregateID)
		return nil
	}
	return handler.Handle(ctx, aggregateID, occurredAt, payload)
}
