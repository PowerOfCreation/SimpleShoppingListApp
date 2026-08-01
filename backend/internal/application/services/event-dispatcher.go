package services

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
)

type EventDispatcher struct {
	handlers map[string]interfaces.EventHandler
}

func NewEventDispatcher(handlers ...interfaces.EventHandler) *EventDispatcher {
	m := make(map[string]interfaces.EventHandler, len(handlers))
	for _, h := range handlers {
		m[h.EventType()] = h
	}
	return &EventDispatcher{handlers: m}
}

// Dispatch routes a single event to its handler. Unknown event types are silently
// ignored so the backend stays forward-compatible with events from newer clients.
func (d *EventDispatcher) Dispatch(ctx context.Context, eventType string, aggregateID uuid.UUID, payload json.RawMessage) error {
	handler, ok := d.handlers[eventType]
	if !ok {
		return nil
	}
	return handler.Handle(ctx, aggregateID, payload)
}
