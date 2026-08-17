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

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
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
// local since this backend has no shared test-double package. Unlike that
// one, this fakeEventRepo keeps the full stored event (not just a bool) -
// tests here need to inspect UserID, which EventController is responsible
// for setting.
type fakeEventRepo struct {
	stored    map[uuid.UUID]*repositories.StoredEvent
	processed map[uuid.UUID]bool
}

func newFakeEventRepo() *fakeEventRepo {
	return &fakeEventRepo{stored: map[uuid.UUID]*repositories.StoredEvent{}, processed: map[uuid.UUID]bool{}}
}

func (f *fakeEventRepo) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, int64, *uuid.UUID, error) {
	if existing, ok := f.stored[event.EventID]; ok {
		return f.processed[event.EventID], 1, existing.ListID, nil
	}
	f.stored[event.EventID] = event
	return false, 1, event.ListID, nil
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

func (f *fakeAckPublisher) PublishAck(userID string, eventID uuid.UUID, seq int64) {
	f.acked[eventID] = true
}

func (f *fakeAckPublisher) PublishListEvent(listID uuid.UUID, seq int64) {}

// stubListAccessService implements interfaces.ListAccessService with one
// overridable function field per method a given test exercises - same
// idiom as stubListSharingService in list-sharing-controller_test.go. An
// unset method panics so an unexpected call fails loudly instead of
// returning a misleading zero value.
type stubListAccessService struct {
	authorizeWrite   func(ctx context.Context, userID string, listIDs []uuid.UUID) error
	filterAccessible func(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error)
	requireRead      func(ctx context.Context, userID string, listID uuid.UUID) error
	requireOwner     func(ctx context.Context, userID string, listID uuid.UUID) error
}

func (s *stubListAccessService) AuthorizeWrite(ctx context.Context, userID string, listIDs []uuid.UUID) error {
	if s.authorizeWrite == nil {
		panic("AuthorizeWrite not used by this test")
	}
	return s.authorizeWrite(ctx, userID, listIDs)
}

func (s *stubListAccessService) FilterAccessible(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	if s.filterAccessible == nil {
		panic("FilterAccessible not used by this test")
	}
	return s.filterAccessible(ctx, userID, listIDs)
}

func (s *stubListAccessService) RequireRead(ctx context.Context, userID string, listID uuid.UUID) error {
	if s.requireRead == nil {
		panic("RequireRead not used by this test")
	}
	return s.requireRead(ctx, userID, listID)
}

func (s *stubListAccessService) RequireOwner(ctx context.Context, userID string, listID uuid.UUID) error {
	if s.requireOwner == nil {
		panic("RequireOwner not used by this test")
	}
	return s.requireOwner(ctx, userID, listID)
}

// allowAllAccess is a stubListAccessService that authorizes every write and
// lets every list through a filter - the default for tests that aren't
// about access control at all.
func allowAllAccess() *stubListAccessService {
	return &stubListAccessService{
		authorizeWrite: func(ctx context.Context, userID string, listIDs []uuid.UUID) error { return nil },
		filterAccessible: func(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			return listIDs, nil
		},
		requireRead:  func(ctx context.Context, userID string, listID uuid.UUID) error { return nil },
		requireOwner: func(ctx context.Context, userID string, listID uuid.UUID) error { return nil },
	}
}

func newTestEventController(t *testing.T, access interfaces.ListAccessService, authMW echo.MiddlewareFunc) (*echo.Echo, *fakeEventRepo, *fakeAckPublisher) {
	repo := newFakeEventRepo()
	ack := &fakeAckPublisher{acked: map[uuid.UUID]bool{}}
	dispatcher := services.NewEventDispatcher(testLogger())
	ingestor := services.NewEventIngestor(testLogger(), repo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	ingestor.Start(ctx)
	t.Cleanup(func() {
		ingestor.Stop()
		cancel()
	})

	e := echo.New()
	NewEventController(e, testLogger(), ingestor, access, authMW)
	return e, repo, ack
}

func TestEventController_SyncEvents_QueuesEventsAndReturns202(t *testing.T) {
	e, _, ack := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	aggregateID := uuid.New()
	listID := uuid.New()
	body := `[{
		"event_id": "` + eventID.String() + `",
		"event_type": "ingredient.created",
		"aggregate_id": "` + aggregateID.String() + `",
		"aggregate_type": "ingredient",
		"list_id": "` + listID.String() + `",
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

func TestEventController_SyncEvents_SetsUserIDFromVerifiedContextNotClientSuppliedField(t *testing.T) {
	e, repo, ack := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	body := `[{
		"event_id": "` + eventID.String() + `",
		"event_type": "todo_list.created",
		"aggregate_id": "` + listID.String() + `",
		"aggregate_type": "todo_list",
		"list_id": "` + listID.String() + `",
		"occurred_at": 1700000000000,
		"client_id": "not-the-verified-user",
		"payload": {"name": "Rewe"}
	}]`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusAccepted, rec.Code)

	require.Eventually(t, func() bool { return ack.acked[eventID] }, time.Second, time.Millisecond)
	assert.Equal(t, "user-1", repo.stored[eventID].UserID)
}

func TestEventController_SyncEvents_MalformedBodyReturns400(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`{not valid json`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestEventController_SyncEvents_EmptyBatchReturns202WithZeroQueued(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`[]`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusAccepted, rec.Code)
	assert.JSONEq(t, `{"queued":0}`, rec.Body.String())
}

func TestEventController_SyncEvents_NoIdentityReturns401(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`[]`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestEventController_SyncEvents_MissingListIDReturns400(t *testing.T) {
	access := &stubListAccessService{
		authorizeWrite: func(ctx context.Context, userID string, listIDs []uuid.UUID) error {
			t.Fatal("AuthorizeWrite must not be called for an unscopable batch")
			return nil
		},
	}
	e, _, _ := newTestEventController(t, access, withUserID("user-1"))

	body := `[{
		"event_id": "` + uuid.New().String() + `",
		"event_type": "todo_list.created",
		"aggregate_id": "` + uuid.New().String() + `",
		"aggregate_type": "todo_list",
		"occurred_at": 1700000000000,
		"client_id": "client-1",
		"payload": {"name": "Rewe"}
	}]`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestEventController_SyncEvents_DeniedListReturns403AndEnqueuesNothing(t *testing.T) {
	access := &stubListAccessService{
		authorizeWrite: func(ctx context.Context, userID string, listIDs []uuid.UUID) error {
			return interfaces.ErrListAccessDenied
		},
	}
	e, repo, _ := newTestEventController(t, access, withUserID("mallory"))

	eventID := uuid.New()
	listID := uuid.New()
	body := `[{
		"event_id": "` + eventID.String() + `",
		"event_type": "todo_list.created",
		"aggregate_id": "` + listID.String() + `",
		"aggregate_type": "todo_list",
		"list_id": "` + listID.String() + `",
		"occurred_at": 1700000000000,
		"client_id": "client-1",
		"payload": {"name": "Rewe"}
	}]`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.NotContains(t, repo.stored, eventID, "a rejected batch must not enqueue any of its events")
}
