package rest

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// stubPullEventRepository implements repositories.EventRepository, but
// only FindListHeads/FindEventsSince are exercised by SyncPullController -
// the others panic if ever called.
type stubPullEventRepository struct {
	findListHeads   func(ctx context.Context, listIDs []uuid.UUID) ([]*repositories.ListHead, error)
	findEventsSince func(ctx context.Context, listID uuid.UUID, sinceSeq int64, limit int32) ([]*repositories.StoredEvent, error)
}

func (s *stubPullEventRepository) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, int64, *uuid.UUID, error) {
	panic("Insert not used by SyncPullController")
}

func (s *stubPullEventRepository) MarkProcessed(ctx context.Context, eventID uuid.UUID) (int64, *uuid.UUID, error) {
	panic("MarkProcessed not used by SyncPullController")
}

func (s *stubPullEventRepository) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	panic("FindUnprocessed not used by SyncPullController")
}

func (s *stubPullEventRepository) FindKnownEventIDsByList(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	panic("FindKnownEventIDsByList not used by SyncPullController")
}

func (s *stubPullEventRepository) FindListHeads(
	ctx context.Context,
	listIDs []uuid.UUID,
) ([]*repositories.ListHead, error) {
	if s.findListHeads == nil {
		return nil, nil
	}
	return s.findListHeads(ctx, listIDs)
}

func (s *stubPullEventRepository) FindEventsSince(
	ctx context.Context,
	listID uuid.UUID,
	sinceSeq int64,
	limit int32,
) ([]*repositories.StoredEvent, error) {
	if s.findEventsSince == nil {
		return nil, nil
	}
	return s.findEventsSince(ctx, listID, sinceSeq, limit)
}

func TestSyncPullController_GetHead_EveryRequestedListIDAppearsInTheResponse(t *testing.T) {
	knownList := uuid.New()
	knownEvent := uuid.New()
	unknownList := uuid.New()

	repo := &stubPullEventRepository{
		findListHeads: func(ctx context.Context, listIDs []uuid.UUID) ([]*repositories.ListHead, error) {
			assert.ElementsMatch(t, []uuid.UUID{knownList, unknownList}, listIDs)
			return []*repositories.ListHead{{ListID: knownList, Seq: 42, EventID: knownEvent}}, nil
		},
	}

	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	body := fmt.Sprintf(`{"list_ids":["%s","%s"]}`, knownList, unknownList)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/head", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, fmt.Sprintf(
		`{"heads":[{"list_id":"%s","seq":42,"event_id":"%s"},{"list_id":"%s","seq":0,"event_id":null}]}`,
		knownList, knownEvent, unknownList,
	), rec.Body.String())
}

func TestSyncPullController_GetHead_MalformedBodyReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/head", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetHead_TooManyListIDsReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	ids := make([]string, maxSyncListIDs+1)
	for i := range ids {
		ids[i] = fmt.Sprintf(`"%s"`, uuid.New())
	}
	body := fmt.Sprintf(`{"list_ids":[%s]}`, strings.Join(ids, ","))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/head", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetHead_RepositoryErrorReturns500(t *testing.T) {
	repo := &stubPullEventRepository{
		findListHeads: func(ctx context.Context, listIDs []uuid.UUID) ([]*repositories.ListHead, error) {
			return nil, assert.AnError
		},
	}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/head", strings.NewReader(`{"list_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestSyncPullController_GetEvents_MissingListIDReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/events", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetEvents_InvalidListIDReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/events?list_id=not-a-uuid", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetEvents_InvalidSinceSeqReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	listID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s&since_seq=not-a-number", listID), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetEvents_InvalidLimitReturns400(t *testing.T) {
	repo := &stubPullEventRepository{}
	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	listID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s&limit=0", listID), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncPullController_GetEvents_HasMoreWhenPageIsFull(t *testing.T) {
	listID := uuid.New()
	e1 := uuid.New()

	repo := &stubPullEventRepository{
		findEventsSince: func(ctx context.Context, gotListID uuid.UUID, sinceSeq int64, limit int32) ([]*repositories.StoredEvent, error) {
			assert.Equal(t, listID, gotListID)
			assert.Equal(t, int64(0), sinceSeq)
			assert.Equal(t, int32(1), limit)
			return []*repositories.StoredEvent{{
				EventID:       e1,
				EventType:     "todo_list.created",
				AggregateID:   listID,
				AggregateType: "todo_list",
				ListID:        &listID,
				Payload:       []byte(`{"name":"Rewe"}`),
				OccurredAt:    time.UnixMilli(1700000000000).UTC(),
				ClientID:      "client-1",
				Seq:           7,
			}}, nil
		},
	}

	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s&limit=1", listID), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, fmt.Sprintf(`{
		"list_id": "%s",
		"events": [{
			"event_id": "%s", "event_type": "todo_list.created",
			"aggregate_id": "%s", "aggregate_type": "todo_list",
			"list_id": "%s", "occurred_at": 1700000000000,
			"client_id": "client-1", "payload": {"name":"Rewe"}, "seq": 7
		}],
		"next_seq": 7,
		"has_more": true
	}`, listID, e1, listID, listID), rec.Body.String())
}

func TestSyncPullController_GetEvents_NoMoreWhenPageIsShort(t *testing.T) {
	listID := uuid.New()

	repo := &stubPullEventRepository{
		findEventsSince: func(ctx context.Context, gotListID uuid.UUID, sinceSeq int64, limit int32) ([]*repositories.StoredEvent, error) {
			return []*repositories.StoredEvent{}, nil
		},
	}

	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s", listID), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"list_id":"%s","events":[],"next_seq":0,"has_more":false}`, listID), rec.Body.String())
}

func TestSyncPullController_GetEvents_ClampsLimitAboveTheMax(t *testing.T) {
	listID := uuid.New()
	var gotLimit int32

	repo := &stubPullEventRepository{
		findEventsSince: func(ctx context.Context, gotListID uuid.UUID, sinceSeq int64, limit int32) ([]*repositories.StoredEvent, error) {
			gotLimit = limit
			return nil, nil
		},
	}

	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s&limit=10000", listID), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, int32(maxPullLimit), gotLimit)
}

func TestSyncPullController_GetEvents_RepositoryErrorReturns500(t *testing.T) {
	repo := &stubPullEventRepository{
		findEventsSince: func(ctx context.Context, gotListID uuid.UUID, sinceSeq int64, limit int32) ([]*repositories.StoredEvent, error) {
			return nil, assert.AnError
		},
	}

	e := echo.New()
	NewSyncPullController(e, testLogger(), repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/sync/events?list_id=%s", uuid.New()), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}
