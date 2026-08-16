package services

import (
	"context"
	"log/slog"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
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
func (d *EventDispatcher) Dispatch(ctx context.Context, event *repositories.StoredEvent) error {
	handler, ok := d.handlers[event.EventType]
	if !ok {
		d.logger.Warn("unknown event type", "event_type", event.EventType, "aggregate_id", event.AggregateID)
		return nil
	}
	return handler.Handle(ctx, event)
}
