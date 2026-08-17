package rest

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// testLogger is shared by every *_test.go file in this package.
func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeEventRepo/fakeAckPublisher mirror the ones in
// internal/application/services/event-ingestor_test.go, kept minimal and
// local since this backend has no shared test-double package.
type fakeEventRepo struct {
	stored    map[uuid.UUID]bool
	processed map[uuid.UUID]bool
}

func newFakeEventRepo() *fakeEventRepo {
	return &fakeEventRepo{stored: map[uuid.UUID]bool{}, processed: map[uuid.UUID]bool{}}
}

func (f *fakeEventRepo) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, int64, *uuid.UUID, error) {
	if f.stored[event.EventID] {
		return f.processed[event.EventID], 1, nil, nil
	}
	f.stored[event.EventID] = true
	return false, 0, nil, nil
}

func (f *fakeEventRepo) MarkProcessed(ctx context.Context, eventID uuid.UUID) error {
	f.processed[eventID] = true
	return nil
}

func (f *fakeEventRepo) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	return nil, nil
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

type fakeAckPublisher struct {
	acked map[uuid.UUID]bool
}

func (f *fakeAckPublisher) PublishAck(clientID string, eventID uuid.UUID, seq int64) {
	f.acked[eventID] = true
}

func (f *fakeAckPublisher) PublishListEvent(listID uuid.UUID, seq int64) {}

func TestEventController_SyncEvents_QueuesEventsAndReturns202(t *testing.T) {
	repo := newFakeEventRepo()
	ack := &fakeAckPublisher{acked: map[uuid.UUID]bool{}}
	dispatcher := services.NewEventDispatcher(testLogger())
	ingestor := services.NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	e := echo.New()
	NewEventController(e, testLogger(), ingestor, middleware.Passthrough)

	eventID := uuid.New()
	aggregateID := uuid.New()
	body := `[{
		"event_id": "` + eventID.String() + `",
		"event_type": "ingredient.created",
		"aggregate_id": "` + aggregateID.String() + `",
		"aggregate_type": "ingredient",
		"occurred_at": 1700000000000,
		"client_id": "client-1",
		"payload": {"name": "Milk"}
	}]`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusAccepted, rec.Code)
	assert.JSONEq(t, `{"queued":1}`, rec.Body.String())

	require.Eventually(t, func() bool {
		return ack.acked[eventID]
	}, time.Second, time.Millisecond, "event should have been processed asynchronously")
}

func TestEventController_SyncEvents_MalformedBodyReturns400(t *testing.T) {
	repo := newFakeEventRepo()
	ack := &fakeAckPublisher{acked: map[uuid.UUID]bool{}}
	dispatcher := services.NewEventDispatcher(testLogger())
	ingestor := services.NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	e := echo.New()
	NewEventController(e, testLogger(), ingestor, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`{not valid json`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestEventController_SyncEvents_EmptyBatchReturns202WithZeroQueued(t *testing.T) {
	repo := newFakeEventRepo()
	ack := &fakeAckPublisher{acked: map[uuid.UUID]bool{}}
	dispatcher := services.NewEventDispatcher(testLogger())
	ingestor := services.NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	e := echo.New()
	NewEventController(e, testLogger(), ingestor, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`[]`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusAccepted, rec.Code)
	assert.JSONEq(t, `{"queued":0}`, rec.Body.String())
}
