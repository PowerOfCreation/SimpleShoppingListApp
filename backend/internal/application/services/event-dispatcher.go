package services

import (
	"context"
	"log/slog"
	"strings"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

// relayOnlyEventPrefix marks event types the server deliberately stores and
// relays without projecting them - list content lives in the frontend's
// projection only (see sync-sharing-target.md 8).
const relayOnlyEventPrefix = "ingredient."

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

// Dispatch routes a single event to its handler. Types without one are silently
// ignored so the backend stays forward-compatible with events from newer clients.
// Only genuinely unexpected types warn: relay-only types have no handler by
// design and are the volume majority, so warning on them would drown out the
// version-skew signal the warning exists for.
func (d *EventDispatcher) Dispatch(ctx context.Context, event *repositories.StoredEvent) error {
	handler, ok := d.handlers[event.EventType]
	if !ok {
		if strings.HasPrefix(event.EventType, relayOnlyEventPrefix) {
			d.logger.Debug("relay-only event type, not projected", "event_type", event.EventType, "aggregate_id", event.AggregateID)
		} else {
			d.logger.Warn("unknown event type", "event_type", event.EventType, "aggregate_id", event.AggregateID)
		}
		return nil
	}
	return handler.Handle(ctx, event)
}
