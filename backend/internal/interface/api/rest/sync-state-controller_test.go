package rest

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// stubEventRepository implements repositories.EventRepository, but only
// FindKnownEventIDsByList is exercised by SyncStateController - the others
// panic if ever called, so a test would fail loudly instead of silently
// doing the wrong thing.
type stubEventRepository struct {
	findKnownEventIDsByList func(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error)
}

func (s *stubEventRepository) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, int64, *uuid.UUID, error) {
	panic("Insert not used by SyncStateController")
}

func (s *stubEventRepository) MarkProcessed(ctx context.Context, eventID uuid.UUID) (int64, *uuid.UUID, error) {
	panic("MarkProcessed not used by SyncStateController")
}

func (s *stubEventRepository) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	panic("FindUnprocessed not used by SyncStateController")
}

func (s *stubEventRepository) FindListHeads(ctx context.Context, listIDs []uuid.UUID) ([]*repositories.ListHead, error) {
	panic("FindListHeads not used by SyncStateController")
}

func (s *stubEventRepository) FindEventsSince(
	ctx context.Context,
	listID uuid.UUID,
	sinceSeq int64,
	limit int32,
) ([]*repositories.StoredEvent, error) {
	panic("FindEventsSince not used by SyncStateController")
}

func (s *stubEventRepository) FindKnownEventIDsByList(
	ctx context.Context,
	listIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	if s.findKnownEventIDsByList == nil {
		return nil, nil
	}
	return s.findKnownEventIDsByList(ctx, listIDs)
}

func TestSyncStateController_ReturnsKnownEventIDsForRequestedLists(t *testing.T) {
	knownList := uuid.New()
	knownEvent := uuid.New()
	unknownList := uuid.New()

	repo := &stubEventRepository{
		findKnownEventIDsByList: func(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			assert.ElementsMatch(t, []uuid.UUID{knownList, unknownList}, listIDs)
			return []uuid.UUID{knownEvent}, nil
		},
	}

	e := echo.New()
	NewSyncStateController(e, repo, middleware.Passthrough)

	body := fmt.Sprintf(`{"list_ids":["%s","%s"]}`, knownList, unknownList)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"known_event_ids":["%s"]}`, knownEvent), rec.Body.String())
}

func TestSyncStateController_MalformedBodyReturns400(t *testing.T) {
	repo := &stubEventRepository{}
	e := echo.New()
	NewSyncStateController(e, repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncStateController_TooManyListIDsReturns400(t *testing.T) {
	repo := &stubEventRepository{}
	e := echo.New()
	NewSyncStateController(e, repo, middleware.Passthrough)

	ids := make([]string, maxSyncListIDs+1)
	for i := range ids {
		ids[i] = fmt.Sprintf(`"%s"`, uuid.New())
	}
	body := fmt.Sprintf(`{"list_ids":[%s]}`, strings.Join(ids, ","))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncStateController_RepositoryErrorReturns500(t *testing.T) {
	repo := &stubEventRepository{
		findKnownEventIDsByList: func(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			return nil, assert.AnError
		},
	}
	e := echo.New()
	NewSyncStateController(e, repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"list_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestSyncStateController_EmptyListIDsReturnsEmptyList(t *testing.T) {
	repo := &stubEventRepository{
		findKnownEventIDsByList: func(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			return nil, nil
		},
	}
	e := echo.New()
	NewSyncStateController(e, repo, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"list_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"known_event_ids":[]}`, rec.Body.String())
}
