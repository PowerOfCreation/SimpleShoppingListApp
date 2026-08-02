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
	seqs        map[uuid.UUID]int64
	insertErr   error
	markErr     error
	unprocessed []*repositories.StoredEvent
	nextSeq     int64
}

func newFakeEventRepo() *fakeEventRepo {
	return &fakeEventRepo{
		stored:    make(map[uuid.UUID]*repositories.StoredEvent),
		processed: make(map[uuid.UUID]bool),
		seqs:      make(map[uuid.UUID]int64),
	}
}

func (f *fakeEventRepo) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, int64, *uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.insertErr != nil {
		return false, 0, nil, f.insertErr
	}
	if existing, exists := f.stored[event.EventID]; exists {
		return f.processed[event.EventID], f.seqs[event.EventID], existing.ListID, nil
	}
	f.stored[event.EventID] = event
	return false, 0, nil, nil
}

func (f *fakeEventRepo) MarkProcessed(ctx context.Context, eventID uuid.UUID) (int64, *uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.markErr != nil {
		return 0, nil, f.markErr
	}
	f.processed[eventID] = true
	f.nextSeq++
	seq := f.nextSeq
	f.seqs[eventID] = seq
	var listID *uuid.UUID
	if event, ok := f.stored[eventID]; ok {
		listID = event.ListID
	}
	return seq, listID, nil
}

func (f *fakeEventRepo) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.unprocessed, nil
}

func (f *fakeEventRepo) FindKnownEventIDsByList(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	return nil, nil
}

func (f *fakeEventRepo) FindListHeads(ctx context.Context, listIDs []uuid.UUID) ([]*repositories.ListHead, error) {
	return nil, nil
}

func (f *fakeEventRepo) FindEventsSince(
	ctx context.Context,
	listID uuid.UUID,
	sinceSeq int64,
	limit int32,
) ([]*repositories.StoredEvent, error) {
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
	seq      int64
}

type listEventCall struct {
	listID uuid.UUID
	seq    int64
}

type fakeAckPublisher struct {
	mu         sync.Mutex
	acked      []ackCall
	listEvents []listEventCall
}

func (f *fakeAckPublisher) PublishAck(clientID string, eventID uuid.UUID, seq int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.acked = append(f.acked, ackCall{clientID, eventID, seq})
}

func (f *fakeAckPublisher) PublishListEvent(listID uuid.UUID, seq int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.listEvents = append(f.listEvents, listEventCall{listID, seq})
}

func (f *fakeAckPublisher) listEventCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.listEvents)
}

func (f *fakeAckPublisher) hasListEvent(listID uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, e := range f.listEvents {
		if e.listID == listID {
			return true
		}
	}
	return false
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

func (f *fakeAckPublisher) seqOf(eventID uuid.UUID) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.acked {
		if a.eventID == eventID {
			return a.seq
		}
	}
	return 0
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

func TestEventIngestor_PublishesAListEventWithTheAssignedSeqAfterProcessing(t *testing.T) {
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
	listID := event.AggregateID
	event.ListID = &listID
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool {
		return ack.hasListEvent(listID)
	}, time.Second, time.Millisecond)

	assert.Equal(t, 1, ack.listEventCount())
}

func TestEventIngestor_DoesNotPublishAListEventWhenTheEventHasNoListID(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	// makeIngestorTestEvent leaves ListID nil - an older client, or an
	// event whose list_id couldn't be resolved.
	event := makeIngestorTestEvent("todo_list.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	// Give a wrongly-published list event a moment to arrive before
	// asserting its absence.
	time.Sleep(20 * time.Millisecond)

	assert.Equal(t, 0, ack.listEventCount())
}

func TestEventIngestor_DuplicateEventID_DoesNotPublishASecondListEvent(t *testing.T) {
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
	listID := event.AggregateID
	event.ListID = &listID
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.hasListEvent(listID) }, time.Second, time.Millisecond)

	// A resend after the ack was lost - nothing newly became visible (the
	// seq this event got was already published), so a client that missed
	// the original notification must recover via its next head check
	// instead of a second notification here.
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.count() == 2 }, time.Second, time.Millisecond)

	assert.Equal(t, 1, ack.listEventCount())
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
	// lost - this must not run the handler again, but must still ack, with
	// the same seq it was originally assigned.
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.count() == 2 }, time.Second, time.Millisecond)

	assert.Equal(t, 1, handler.callCount())
	assert.Equal(t, ack.seqOf(event.EventID), int64(1))
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
