package services

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

// debugLogger logs at debug level into a buffer, so a test can tell apart the
// two levels a handler-less event type can produce.
func debugLogger() (*slog.Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	return slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})), buf
}

func dispatch(t *testing.T, d *EventDispatcher, eventType string) {
	t.Helper()
	require.NoError(t, d.Dispatch(context.Background(), &repositories.StoredEvent{
		EventID:     uuid.New(),
		EventType:   eventType,
		AggregateID: uuid.New(),
	}))
}

// TestEventDispatcher_RelayOnlyEventTypesDoNotWarn guards the version-skew
// signal: ingredient.* has no handler by design (sync-sharing-target.md 8) and
// is the volume majority of what clients push, so warning on it would make the
// "unknown event type" warning useless for the case it exists for.
func TestEventDispatcher_RelayOnlyEventTypesDoNotWarn(t *testing.T) {
	logger, buf := debugLogger()
	dispatcher := NewEventDispatcher(logger)

	for _, eventType := range []string{
		"ingredient.created",
		"ingredient.updated",
		"ingredient.deleted",
		"ingredient.priority_set",
		"ingredient.priority_cleared",
	} {
		dispatch(t, dispatcher, eventType)
	}

	assert.NotContains(t, buf.String(), `"level":"WARN"`)
	assert.Contains(t, buf.String(), "relay-only event type")
}

// TestEventDispatcher_GenuinelyUnknownEventTypeWarns is the other half: a type
// that is neither handled nor deliberately relay-only still signals skew.
func TestEventDispatcher_GenuinelyUnknownEventTypeWarns(t *testing.T) {
	logger, buf := debugLogger()
	dispatcher := NewEventDispatcher(logger)

	dispatch(t, dispatcher, "shopping_cart.checked_out")

	assert.Contains(t, buf.String(), `"level":"WARN"`)
	assert.Contains(t, buf.String(), "unknown event type")
}

// TestEventDispatcher_HandledEventTypeReachesItsHandler keeps the relay-only
// branch from swallowing a type that does have a handler.
func TestEventDispatcher_HandledEventTypeReachesItsHandler(t *testing.T) {
	handler := &fakeHandler{eventType: "todo_list.created"}
	logger, buf := debugLogger()
	dispatcher := NewEventDispatcher(logger, handler)

	dispatch(t, dispatcher, "todo_list.created")

	handler.mu.Lock()
	defer handler.mu.Unlock()
	assert.Equal(t, 1, handler.calls)
	assert.False(t, strings.Contains(buf.String(), "unknown event type"))
}
