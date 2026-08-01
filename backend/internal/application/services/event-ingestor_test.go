package services

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

// fakeEventRepo is a hand-rolled in-memory double - this backend has no
// mocking library, and testcontainers (used elsewhere) would be overkill
// for testing the ingestor's own orchestration logic, which is what these
// tests care about.
type fakeEventRepo struct {
	mu          sync.Mutex
	stored      map[uuid.UUID]*repositories.StoredEvent
	processed   map[uuid.UUID]bool
	insertErr   error
	markErr     error
	unprocessed []*repositories.StoredEvent
}

func newFakeEventRepo() *fakeEventRepo {
	return &fakeEventRepo{
		stored:    make(map[uuid.UUID]*repositories.StoredEvent),
		processed: make(map[uuid.UUID]bool),
	}
}

func (f *fakeEventRepo) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.insertErr != nil {
		return false, f.insertErr
	}
	if _, exists := f.stored[event.EventID]; exists {
		return f.processed[event.EventID], nil
	}
	f.stored[event.EventID] = event
	return false, nil
}

func (f *fakeEventRepo) MarkProcessed(ctx context.Context, eventID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.markErr != nil {
		return f.markErr
	}
	f.processed[eventID] = true
	return nil
}

func (f *fakeEventRepo) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.unprocessed, nil
}

func (f *fakeEventRepo) FindKnownEventIDs(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error) {
	return nil, nil
}

func (f *fakeEventRepo) isProcessed(id uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.processed[id]
}

type ackCall struct {
	clientID string
	eventID  uuid.UUID
}

type fakeAckPublisher struct {
	mu    sync.Mutex
	acked []ackCall
}

func (f *fakeAckPublisher) PublishAck(clientID string, eventID uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.acked = append(f.acked, ackCall{clientID, eventID})
}

func (f *fakeAckPublisher) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.acked)
}

func (f *fakeAckPublisher) has(eventID uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.acked {
		if a.eventID == eventID {
			return true
		}
	}
	return false
}

type fakeHandler struct {
	eventType string
	err       error
	mu        sync.Mutex
	calls     int
}

func (h *fakeHandler) EventType() string { return h.eventType }

func (h *fakeHandler) Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.calls++
	return h.err
}

func (h *fakeHandler) callCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls
}

func makeIngestorTestEvent(eventType string) *repositories.StoredEvent {
	return &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     eventType,
		AggregateID:   uuid.New(),
		AggregateType: "todo_list",
		Payload:       json.RawMessage(`{"name":"Rewe"}`),
		OccurredAt:    time.Now().UTC(),
		ClientID:      "client-1",
	}
}

func TestEventIngestor_ProcessesAndAcksAFreshEvent(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool {
		return ack.has(event.EventID)
	}, time.Second, time.Millisecond)

	assert.Equal(t, 1, handler.callCount())
	assert.True(t, repo.isProcessed(event.EventID))
}

func TestEventIngestor_DuplicateEventID_AcksWithoutRedispatching(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)

	// A resend of the exact same event, e.g. because the client's ack got
	// lost - this must not run the handler again, but must still ack.
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.count() == 2 }, time.Second, time.Millisecond)

	assert.Equal(t, 1, handler.callCount())
}

func TestEventIngestor_DispatchFailure_NoAckAndNotMarkedProcessed(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.updated", err: errors.New("todo list not found")}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.updated")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return handler.callCount() == 1 }, time.Second, time.Millisecond)
	// Give any (incorrect) ack a moment to arrive before asserting its absence.
	time.Sleep(20 * time.Millisecond)

	assert.False(t, ack.has(event.EventID))
	assert.False(t, repo.isProcessed(event.EventID))
}

func TestEventIngestor_UnknownEventType_StillAckedForwardCompatibly(t *testing.T) {
	repo := newFakeEventRepo()
	// No handler registered for "ingredient.created" - EventDispatcher
	// silently no-ops per its own forward-compatibility contract.
	dispatcher := NewEventDispatcher()
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("ingredient.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	assert.True(t, repo.isProcessed(event.EventID))
}

func TestEventIngestor_Start_SweepsUnprocessedEventsFromPreviousRun(t *testing.T) {
	repo := newFakeEventRepo()
	stuck := makeIngestorTestEvent("todo_list.created")
	repo.unprocessed = []*repositories.StoredEvent{stuck}

	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	require.Eventually(t, func() bool { return ack.has(stuck.EventID) }, time.Second, time.Millisecond)
	assert.Equal(t, 1, handler.callCount())
	assert.True(t, repo.isProcessed(stuck.EventID))
}

func TestEventIngestor_ProcessesEventsForTheSameAggregateInEnqueueOrder(t *testing.T) {
	repo := newFakeEventRepo()
	var mu sync.Mutex
	var order []string

	handler := &orderTrackingHandler{
		eventType: "todo_list.updated",
		onHandle: func(aggregateID uuid.UUID, payload json.RawMessage) {
			mu.Lock()
			defer mu.Unlock()
			order = append(order, string(payload))
		},
	}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	aggregateID := uuid.New()
	first := makeIngestorTestEvent("todo_list.updated")
	first.AggregateID = aggregateID
	first.Payload = json.RawMessage(`"first"`)
	second := makeIngestorTestEvent("todo_list.updated")
	second.AggregateID = aggregateID
	second.Payload = json.RawMessage(`"second"`)

	// Enqueued strictly in order, as a single flush batch would be.
	require.NoError(t, ingestor.Enqueue(ctx, first))
	require.NoError(t, ingestor.Enqueue(ctx, second))

	require.Eventually(t, func() bool { return ack.has(second.EventID) }, time.Second, time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, []string{`"first"`, `"second"`}, order)
}

type orderTrackingHandler struct {
	eventType string
	onHandle  func(aggregateID uuid.UUID, payload json.RawMessage)
}

func (h *orderTrackingHandler) EventType() string { return h.eventType }

func (h *orderTrackingHandler) Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error {
	h.onHandle(aggregateID, payload)
	return nil
}

func TestEventIngestor_Stop_ReturnsWithoutHanging(t *testing.T) {
	repo := newFakeEventRepo()
	dispatcher := NewEventDispatcher()
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)

	done := make(chan struct{})
	go func() {
		ingestor.Stop()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Stop() did not return in time")
	}
}
