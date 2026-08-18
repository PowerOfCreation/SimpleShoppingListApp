package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// syncBuffer wraps bytes.Buffer with a mutex so it's safe to write from the
// ingestor's worker goroutine while a test concurrently polls it (e.g. via
// require.Eventually, which runs its check function in its own goroutine) -
// slog's handler only synchronizes its own writes against each other, not
// against unrelated reads of the same io.Writer.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Len()
}

func (s *syncBuffer) Bytes() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.buf.Bytes()...)
}

// fakeEventRepo is a hand-rolled in-memory double - this backend has no
// mocking library, and testcontainers (used elsewhere) would be overkill
// for testing the ingestor's own orchestration logic, which is what these
// tests care about. Insert assigns seq immediately (mirroring migration
// 00006-events-seq-at-insert), in call order, and order records that
// assignment order so FindUnprocessed can replay it - exactly the property
// the real ORDER BY seq query guarantees.
type fakeEventRepo struct {
	mu        sync.Mutex
	stored    map[uuid.UUID]*repositories.StoredEvent
	processed map[uuid.UUID]bool
	seqs      map[uuid.UUID]int64
	order     []uuid.UUID
	insertErr error
	markErr   error
	nextSeq   int64
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
	f.nextSeq++
	seq := f.nextSeq
	f.stored[event.EventID] = event
	f.seqs[event.EventID] = seq
	f.order = append(f.order, event.EventID)
	return false, seq, event.ListID, nil
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
	var result []*repositories.StoredEvent
	for _, id := range f.order {
		if f.processed[id] {
			continue
		}
		event := f.stored[id]
		event.Seq = f.seqs[id]
		result = append(result, event)
	}
	return result, nil
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
	userID  string
	eventID uuid.UUID
	seq     int64
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

func (f *fakeAckPublisher) PublishAck(userID string, eventID uuid.UUID, seq int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.acked = append(f.acked, ackCall{userID, eventID, seq})
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

func (h *fakeHandler) Handle(ctx context.Context, event *repositories.StoredEvent) error {
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

// selectiveFailHandler fails only for one specific event_id, succeeding for
// every other event of the same type - used to make one event in a batch
// stay stuck (transiently) while a later one for the same list goes
// through, without needing two different dispatchers/event types.
type selectiveFailHandler struct {
	eventType   string
	failEventID uuid.UUID
	err         error
}

func (h *selectiveFailHandler) EventType() string { return h.eventType }

func (h *selectiveFailHandler) Handle(ctx context.Context, event *repositories.StoredEvent) error {
	if event.EventID == h.failEventID {
		return h.err
	}
	return nil
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
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	// See the note in todo-list-service_test.go: the ack lands before apply
	// runs, so isProcessed is the signal that covers both.
	require.Eventually(t, func() bool {
		return repo.isProcessed(event.EventID)
	}, time.Second, time.Millisecond)

	assert.Equal(t, 1, handler.callCount())
	assert.True(t, ack.has(event.EventID))
}

func TestEventIngestor_PublishesAListEventWithTheAssignedSeqAfterProcessing(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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

// TestEventIngestor_TransientDispatchFailure_StillAcksWithLogPosition
// covers a transient dispatch error (a plain, unwrapped error - e.g. a DB
// connection blip): the event is still acked, immediately, since ack means
// "durably in the log", not "applied" (see migration
// 00006-events-seq-at-insert) - but it stays unprocessed so sweepUnprocessed
// retries it, unlike a permanent error (see the Permanent_ tests below).
func TestEventIngestor_TransientDispatchFailure_StillAcksWithLogPosition(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.updated", err: errors.New("connection reset by peer")}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.updated")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	require.Eventually(t, func() bool { return handler.callCount() == 1 }, time.Second, time.Millisecond)

	assert.Greater(t, ack.seqOf(event.EventID), int64(0))
	assert.False(t, repo.isProcessed(event.EventID))
}

// TestEventIngestor_StuckEventKeepsItsLogPositionAheadOfLaterEvents is the
// regression test for migration 00006-events-seq-at-insert: under the old
// model (seq assigned at MarkProcessed), a transiently-failing event kept
// no seq at all until a later retry succeeded, so a second event for the
// same list - enqueued after the first but applied without trouble - could
// get a *lower* seq than the one still stuck. Every client replays by seq
// (byServerSeqThenLocal), so that inversion corrupted replay order for
// everyone. Now seq is fixed at Insert, before apply ever runs, so this
// can't happen.
func TestEventIngestor_StuckEventKeepsItsLogPositionAheadOfLaterEvents(t *testing.T) {
	repo := newFakeEventRepo()
	listID := uuid.New()

	stuck := makeIngestorTestEvent("todo_list.updated")
	stuck.ListID = &listID
	later := makeIngestorTestEvent("todo_list.updated")
	later.ListID = &listID

	handler := &selectiveFailHandler{
		eventType:   "todo_list.updated",
		failEventID: stuck.EventID,
		err:         errors.New("connection reset by peer"),
	}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	// stuck fails to apply (transient); later, for the same list, is
	// enqueued right after and applies cleanly.
	require.NoError(t, ingestor.Enqueue(ctx, stuck))
	require.NoError(t, ingestor.Enqueue(ctx, later))

	// Waiting on later's apply (not just its ack) also pins down stuck's:
	// one worker, strict FIFO, so stuck's failed apply is already behind us.
	require.Eventually(t, func() bool { return repo.isProcessed(later.EventID) }, time.Second, time.Millisecond)
	require.True(t, ack.has(later.EventID))
	require.True(t, ack.has(stuck.EventID))

	assert.Less(t, ack.seqOf(stuck.EventID), ack.seqOf(later.EventID))
	assert.False(t, repo.isProcessed(stuck.EventID))
	assert.True(t, repo.isProcessed(later.EventID))
}

// TestEventIngestor_DispatchFailure_LogsWithEventContext asserts the
// injected logger is actually used, not just accepted - a failed dispatch
// must produce a structured error record carrying the event id, so an
// on-call engineer can find it without a debugger.
func TestEventIngestor_DispatchFailure_LogsWithEventContext(t *testing.T) {
	var buf syncBuffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.updated", err: errors.New("connection reset by peer")}
	dispatcher := NewEventDispatcher(logger, handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(logger, repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.updated")
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return handler.callCount() == 1 }, time.Second, time.Millisecond)
	// Give the (async) log write a moment to land.
	require.Eventually(t, func() bool { return buf.Len() > 0 }, time.Second, time.Millisecond)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &decoded))
	assert.Equal(t, "ERROR", decoded["level"])
	assert.Equal(t, event.EventID.String(), decoded["event_id"])
	assert.Contains(t, decoded["error"], "connection reset by peer")
}

// TestEventIngestor_PermanentDispatchFailure_MarkedProcessedAndAcked is the
// counterpart to the transient case above: a handler error wrapped in
// interfaces.ErrPermanent (bad payload, failed validation - unfixable by
// retrying) must be treated like the unknown-event-type no-op path -
// recorded (MarkProcessed) as well as acked, not left to poison
// sweepUnprocessed forever. Acking itself isn't unique to this path
// anymore (see the transient test above) - what's unique is that this one
// also ends up processed.
func TestEventIngestor_PermanentDispatchFailure_MarkedProcessedAndAcked(t *testing.T) {
	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.updated", err: interfaces.Permanent(errors.New("name must not be empty"))}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.updated")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	require.Eventually(t, func() bool { return repo.isProcessed(event.EventID) }, time.Second, time.Millisecond)
	assert.Equal(t, 1, handler.callCount())
}

// TestEventIngestor_PermanentDispatchFailure_LogsWithEventContext mirrors
// TestEventIngestor_DispatchFailure_LogsWithEventContext for the permanent
// path - silently swallowing an unprocessable event would be as bad as
// looping on it forever.
func TestEventIngestor_PermanentDispatchFailure_LogsWithEventContext(t *testing.T) {
	var buf syncBuffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	repo := newFakeEventRepo()
	handler := &fakeHandler{eventType: "todo_list.updated", err: interfaces.Permanent(errors.New("name must not be empty"))}
	dispatcher := NewEventDispatcher(logger, handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(logger, repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("todo_list.updated")
	require.NoError(t, ingestor.Enqueue(ctx, event))
	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	require.Eventually(t, func() bool { return buf.Len() > 0 }, time.Second, time.Millisecond)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &decoded))
	assert.Equal(t, "ERROR", decoded["level"])
	assert.Equal(t, event.EventID.String(), decoded["event_id"])
	assert.Contains(t, decoded["error"], "name must not be empty")
}

func TestEventIngestor_UnknownEventType_StillAckedForwardCompatibly(t *testing.T) {
	repo := newFakeEventRepo()
	// No handler registered for "ingredient.created" - EventDispatcher
	// silently no-ops per its own forward-compatibility contract.
	dispatcher := NewEventDispatcher(testLogger())
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	event := makeIngestorTestEvent("ingredient.created")
	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	require.Eventually(t, func() bool { return repo.isProcessed(event.EventID) }, time.Second, time.Millisecond)
}

// TestEventIngestor_Start_SweepsUnprocessedEventsFromPreviousRun simulates
// a row a previous process instance durably inserted (and thus already
// acked, in that earlier run) but crashed before applying - calling
// Insert directly, without going through Enqueue/process, is exactly what
// that prior run's process() would have left behind.
func TestEventIngestor_Start_SweepsUnprocessedEventsFromPreviousRun(t *testing.T) {
	repo := newFakeEventRepo()
	stuck := makeIngestorTestEvent("todo_list.created")
	_, _, _, err := repo.Insert(context.Background(), stuck)
	require.NoError(t, err)

	handler := &fakeHandler{eventType: "todo_list.created"}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	require.Eventually(t, func() bool { return repo.isProcessed(stuck.EventID) }, time.Second, time.Millisecond)
	assert.Equal(t, 1, handler.callCount())
}

// seqOrderHandler records the order in which events actually reach the
// handler, by event_id - used to assert the sweep replays strictly in the
// order FindUnprocessed returned them (seq order, per the real repository).
type seqOrderHandler struct {
	eventType string
	mu        sync.Mutex
	order     []uuid.UUID
}

func (h *seqOrderHandler) EventType() string { return h.eventType }

func (h *seqOrderHandler) Handle(ctx context.Context, event *repositories.StoredEvent) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.order = append(h.order, event.EventID)
	return nil
}

func (h *seqOrderHandler) snapshot() []uuid.UUID {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]uuid.UUID(nil), h.order...)
}

func TestEventIngestor_Sweep_ReplaysInSeqOrder(t *testing.T) {
	repo := newFakeEventRepo()
	ctx := context.Background()

	first := makeIngestorTestEvent("todo_list.updated")
	second := makeIngestorTestEvent("todo_list.updated")
	third := makeIngestorTestEvent("todo_list.updated")
	// Durably inserted (seq-assigned) in this order by a prior run, never
	// applied - see TestEventIngestor_Start_SweepsUnprocessedEventsFromPreviousRun.
	for _, e := range []*repositories.StoredEvent{first, second, third} {
		_, _, _, err := repo.Insert(ctx, e)
		require.NoError(t, err)
	}

	handler := &seqOrderHandler{eventType: "todo_list.updated"}
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

	tctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(tctx)
	defer ingestor.Stop()

	require.Eventually(t, func() bool { return repo.isProcessed(third.EventID) }, time.Second, time.Millisecond)

	assert.Equal(t, []uuid.UUID{first.EventID, second.EventID, third.EventID}, handler.snapshot())
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
	dispatcher := NewEventDispatcher(testLogger(), handler)
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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

func (h *orderTrackingHandler) Handle(ctx context.Context, event *repositories.StoredEvent) error {
	h.onHandle(event.AggregateID, event.Payload)
	return nil
}

func TestEventIngestor_Stop_ReturnsWithoutHanging(t *testing.T) {
	repo := newFakeEventRepo()
	dispatcher := NewEventDispatcher(testLogger())
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), repo, dispatcher, ack)

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
