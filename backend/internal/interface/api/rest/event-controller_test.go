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
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// testLogger is shared by every *_test.go file in this package.
func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeEventRepo is a hand-rolled in-memory double for
// repositories.EventRepository - this backend has no mocking library, and
// these tests care about the controller's own orchestration (what it
// authorizes/validates/appends), not persistence. It keeps the full stored
// event (not just a bool) - tests here need to inspect UserID, which
// EventController is responsible for setting.
type fakeEventRepo struct {
	byList map[uuid.UUID][]*repositories.StoredEvent
	seen   map[uuid.UUID]*repositories.StoredEvent
}

func newFakeEventRepo() *fakeEventRepo {
	return &fakeEventRepo{
		byList: map[uuid.UUID][]*repositories.StoredEvent{},
		seen:   map[uuid.UUID]*repositories.StoredEvent{},
	}
}

func (f *fakeEventRepo) AppendToList(
	ctx context.Context,
	listID uuid.UUID,
	events []*repositories.StoredEvent,
	now time.Time,
) (int64, bool, error) {
	appended := false
	headSeq := int64(len(f.byList[listID]))
	for _, event := range events {
		if existing, ok := f.seen[event.EventID]; ok {
			event.Seq = existing.Seq
			continue
		}
		headSeq++
		event.Seq = headSeq
		f.seen[event.EventID] = event
		f.byList[listID] = append(f.byList[listID], event)
		appended = true
	}
	return headSeq, appended, nil
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

type fakeListEventPublisher struct {
	notified map[uuid.UUID]int64
}

func newFakeListEventPublisher() *fakeListEventPublisher {
	return &fakeListEventPublisher{notified: map[uuid.UUID]int64{}}
}

func (f *fakeListEventPublisher) PublishListEvent(listID uuid.UUID, seq int64) {
	f.notified[listID] = seq
}

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

func newTestEventController(t *testing.T, access interfaces.ListAccessService, authMW echo.MiddlewareFunc) (*echo.Echo, *fakeEventRepo, *fakeListEventPublisher) {
	repo := newFakeEventRepo()
	publisher := newFakeListEventPublisher()

	e := echo.New()
	NewEventController(e, testLogger(), repo, access, publisher, authMW)
	return e, repo, publisher
}

func TestEventController_SyncEvents_AppendsEventsAndReturns200(t *testing.T) {
	e, _, publisher := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

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

	assert.Equal(t, http.StatusOK, rec.Code)
	// The body is the confirmation - there is no second delivery over the
	// WebSocket for the caller's own push.
	assert.JSONEq(t, `{"queued":1,"acked":[{"event_id":"`+eventID.String()+`","seq":1}]}`, rec.Body.String())
	assert.Equal(t, int64(1), publisher.notified[listID], "list subscribers should have been notified")
}

func TestEventController_SyncEvents_SetsUserIDFromVerifiedContextNotClientSuppliedField(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

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
	require.Equal(t, http.StatusOK, rec.Code)

	assert.JSONEq(t, `{"queued":1,"acked":[{"event_id":"`+eventID.String()+`","seq":1}]}`, rec.Body.String())
	assert.Equal(t, "user-1", repo.seen[eventID].UserID)
}

func TestEventController_SyncEvents_MalformedBodyReturns400(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`{not valid json`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestEventController_SyncEvents_EmptyBatchReturns200WithZeroQueued(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(`[]`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"queued":0,"acked":[]}`, rec.Body.String())
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

func TestEventController_SyncEvents_DeniedListReturns403AndAppendsNothing(t *testing.T) {
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
	assert.NotContains(t, repo.seen, eventID, "a rejected batch must not append any of its events")
}

// syncEvent builds one event JSON object for a request body. payload must
// itself be a valid JSON value (or the empty string to omit the field
// entirely) - see TestEventController_SyncEvents_MissingPayloadReturns400's
// comment for why "syntactically invalid JSON payload" can only be reached
// that way once the request has to bind as valid JSON in the first place.
func syncEvent(eventID, aggregateID, aggregateType, eventType string, listID *uuid.UUID, payload string) string {
	listIDField := "null"
	if listID != nil {
		listIDField = `"` + listID.String() + `"`
	}
	payloadField := ""
	if payload != "" {
		payloadField = `, "payload": ` + payload
	}
	return `{
		"event_id": "` + eventID + `",
		"event_type": "` + eventType + `",
		"aggregate_id": "` + aggregateID + `",
		"aggregate_type": "` + aggregateType + `",
		"list_id": ` + listIDField + `,
		"occurred_at": 1700000000000,
		"client_id": "client-1"` + payloadField + `
	}`
}

// TestEventController_SyncEvents_MissingPayloadReturns400 is this
// controller's json.Valid(payload) check. It cannot be triggered by a
// syntactically-broken payload value (e.g. "{name": ) - the outer request
// body would then fail to parse as JSON at all, well before
// validateEventStructure ever sees it, and that's already covered by
// TestEventController_SyncEvents_MalformedBodyReturns400. The only payload
// that is well-formed enough for the request to bind but still fails
// json.Valid is a payload field that's missing outright (an empty
// json.RawMessage) - e.g. an older or buggy client that dropped the field.
func TestEventController_SyncEvents_MissingPayloadReturns400(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	body := "[" + syncEvent(eventID.String(), listID.String(), "todo_list", "todo_list.created", &listID, "") + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, repo.seen, eventID, "a structurally invalid event must not reach the events table")
}

// TestEventController_SyncEvents_ToDoListEventWithMismatchedAggregateIDReturns400
// is the addressing check: a todo_list.* event's aggregate_id must equal
// its own list_id, since for these event types the list is the aggregate.
func TestEventController_SyncEvents_ToDoListEventWithMismatchedAggregateIDReturns400(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	otherAggregateID := uuid.New()
	body := "[" + syncEvent(eventID.String(), otherAggregateID.String(), "todo_list", "todo_list.created", &listID, `{"name": "Rewe"}`) + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, repo.seen, eventID)
}

// TestEventController_SyncEvents_OversizedEventPayloadReturns400 checks the
// per-event size cap (maxEventPayloadBytes).
func TestEventController_SyncEvents_OversizedEventPayloadReturns400(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	oversizedName := `"` + strings.Repeat("a", maxEventPayloadBytes+1) + `"`
	body := "[" + syncEvent(eventID.String(), listID.String(), "todo_list", "todo_list.created", &listID, `{"name": `+oversizedName+`}`) + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, repo.seen, eventID)
}

// TestEventController_SyncEvents_OversizedBatchReturns400 checks the
// per-batch size cap (maxBatchPayloadBytes): every individual event here
// stays under maxEventPayloadBytes, only their sum exceeds
// maxBatchPayloadBytes.
func TestEventController_SyncEvents_OversizedBatchReturns400(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	const perEventSize = maxEventPayloadBytes - 200
	const numEvents = (maxBatchPayloadBytes / perEventSize) + 2

	eventIDs := make([]uuid.UUID, numEvents)
	parts := make([]string, numEvents)
	name := `"` + strings.Repeat("a", perEventSize) + `"`
	for i := range parts {
		eventIDs[i] = uuid.New()
		listID := uuid.New()
		parts[i] = syncEvent(eventIDs[i].String(), listID.String(), "todo_list", "todo_list.created", &listID, `{"name": `+name+`}`)
	}
	body := "[" + strings.Join(parts, ",") + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, repo.seen, eventIDs[0], "a rejected batch must not append any of its events")
}

// TestEventController_SyncEvents_OneStructurallyBrokenEventRejectsWholeBatch
// mirrors TestEventController_SyncEvents_DeniedListReturns403AndAppendsNothing
// for validateEventStructure: one bad event anywhere in the batch means
// none of the batch's events - including otherwise-fine ones - get
// appended, matching distinctListIDs/AuthorizeWrite's existing all-or-
// nothing semantics.
func TestEventController_SyncEvents_OneStructurallyBrokenEventRejectsWholeBatch(t *testing.T) {
	e, repo, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	goodEventID := uuid.New()
	goodListID := uuid.New()
	brokenEventID := uuid.New()
	brokenListID := uuid.New()
	body := "[" +
		syncEvent(goodEventID.String(), goodListID.String(), "todo_list", "todo_list.created", &goodListID, `{"name": "Rewe"}`) +
		"," +
		syncEvent(brokenEventID.String(), brokenListID.String(), "todo_list", "todo_list.created", &brokenListID, "") +
		"]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, repo.seen, goodEventID)
	assert.NotContains(t, repo.seen, brokenEventID)
}

// TestEventController_SyncEvents_UnknownEventTypeIsAcceptedAndRelayed is the
// forward-compatibility counterpart to every rejection test above: a
// structurally valid event of a type this server doesn't know about (e.g.
// from a newer client) must still be accepted and appended, not rejected
// with a 400 - the frontend treats 400 as non-retryable and disables sync
// for the whole list on it (see sync-client.ts's nonRetryableError).
func TestEventController_SyncEvents_UnknownEventTypeIsAcceptedAndRelayed(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	aggregateID := uuid.New()
	listID := uuid.New()
	body := "[" + syncEvent(eventID.String(), aggregateID.String(), "widget", "widget.frobbed", &listID, `{"whatever": "the server has never heard of this"}`) + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"queued":1,"acked":[{"event_id":"`+eventID.String()+`","seq":1}]}`, rec.Body.String())
}

// TestEventController_SyncEvents_EmptyNameToDoListCreatedIsAccepted
// documents that the server is deliberately blind to payload content: it
// validates structure (this event's aggregate_id equals its list_id,
// payload is valid JSON, sizes are in bounds), never semantics. An empty
// name is a client-side concern to harden separately.
func TestEventController_SyncEvents_EmptyNameToDoListCreatedIsAccepted(t *testing.T) {
	e, _, _ := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	body := "[" + syncEvent(eventID.String(), listID.String(), "todo_list", "todo_list.created", &listID, `{"name": ""}`) + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"queued":1,"acked":[{"event_id":"`+eventID.String()+`","seq":1}]}`, rec.Body.String())
}

// TestEventController_SyncEvents_RedeliveredEventDoesNotRenotifySubscribers
// is the pure-echo case: a batch whose every event already exists (e.g. a
// redelivered page, or the sender's own push looped back) makes nothing
// newly visible, so PublishListEvent must not fire - see AppendToList's
// `appended` return value.
func TestEventController_SyncEvents_RedeliveredEventDoesNotRenotifySubscribers(t *testing.T) {
	e, _, publisher := newTestEventController(t, allowAllAccess(), withUserID("user-1"))

	eventID := uuid.New()
	listID := uuid.New()
	body := "[" + syncEvent(eventID.String(), listID.String(), "todo_list", "todo_list.created", &listID, `{"name": "Rewe"}`) + "]"

	req := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	e.ServeHTTP(httptest.NewRecorder(), req)
	require.Contains(t, publisher.notified, listID)
	delete(publisher.notified, listID)

	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/events", strings.NewReader(body))
	req2.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec2 := httptest.NewRecorder()
	e.ServeHTTP(rec2, req2)

	assert.Equal(t, http.StatusOK, rec2.Code)
	// A redelivery is still confirmed, with the seq the event got the first
	// time - that is what lets a client whose original response was lost
	// self-heal by simply re-pushing.
	assert.JSONEq(t, `{"queued":1,"acked":[{"event_id":"`+eventID.String()+`","seq":1}]}`, rec2.Body.String())
	assert.NotContains(t, publisher.notified, listID, "a pure-echo batch must not renotify subscribers")
}
