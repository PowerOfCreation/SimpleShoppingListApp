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

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
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

func (s *stubEventRepository) AppendToList(
	ctx context.Context,
	listID uuid.UUID,
	events []*repositories.StoredEvent,
	now time.Time,
) (int64, bool, error) {
	panic("AppendToList not used by SyncStateController")
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

func newTestSyncStateController(repo repositories.EventRepository, access interfaces.ListAccessService, authMW echo.MiddlewareFunc) *echo.Echo {
	e := echo.New()
	NewSyncStateController(e, testLogger(), repo, access, authMW)
	return e
}

func TestSyncStateController_ReturnsKnownEventIDsForAccessibleLists(t *testing.T) {
	knownList := uuid.New()
	knownEvent := uuid.New()
	foreignList := uuid.New()

	repo := &stubEventRepository{
		findKnownEventIDsByList: func(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			// foreignList was filtered out by FilterAccessible - the
			// repository is never even asked about it.
			assert.ElementsMatch(t, []uuid.UUID{knownList}, listIDs)
			return []uuid.UUID{knownEvent}, nil
		},
	}
	access := &stubListAccessService{
		filterAccessible: func(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
			return []uuid.UUID{knownList}, nil
		},
	}

	e := newTestSyncStateController(repo, access, withUserID("user-1"))

	body := fmt.Sprintf(`{"list_ids":["%s","%s"]}`, knownList, foreignList)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"known_event_ids":["%s"]}`, knownEvent), rec.Body.String())
}

func TestSyncStateController_NoIdentityReturns401(t *testing.T) {
	e := newTestSyncStateController(&stubEventRepository{}, &stubListAccessService{}, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"list_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestSyncStateController_MalformedBodyReturns400(t *testing.T) {
	e := newTestSyncStateController(&stubEventRepository{}, &stubListAccessService{}, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncStateController_TooManyListIDsReturns400(t *testing.T) {
	e := newTestSyncStateController(&stubEventRepository{}, &stubListAccessService{}, withUserID("user-1"))

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

	e := newTestSyncStateController(repo, allowAllAccess(), withUserID("user-1"))

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

	e := newTestSyncStateController(repo, allowAllAccess(), withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"list_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"known_event_ids":[]}`, rec.Body.String())
}
