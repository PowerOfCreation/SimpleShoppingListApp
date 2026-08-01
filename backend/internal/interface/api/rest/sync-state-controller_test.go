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
)

// stubEventRepository implements repositories.EventRepository, but only
// FindKnownEventIDs is exercised by SyncStateController - the others panic
// if ever called, so a test would fail loudly instead of silently doing
// the wrong thing.
type stubEventRepository struct {
	findKnownEventIDs func(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error)
}

func (s *stubEventRepository) Insert(ctx context.Context, event *repositories.StoredEvent) (bool, error) {
	panic("Insert not used by SyncStateController")
}

func (s *stubEventRepository) MarkProcessed(ctx context.Context, eventID uuid.UUID) error {
	panic("MarkProcessed not used by SyncStateController")
}

func (s *stubEventRepository) FindUnprocessed(ctx context.Context) ([]*repositories.StoredEvent, error) {
	panic("FindUnprocessed not used by SyncStateController")
}

func (s *stubEventRepository) FindKnownEventIDs(
	ctx context.Context,
	aggregateIDs []uuid.UUID,
) ([]uuid.UUID, error) {
	if s.findKnownEventIDs == nil {
		return nil, nil
	}
	return s.findKnownEventIDs(ctx, aggregateIDs)
}

func TestSyncStateController_ReturnsKnownEventIDsForRequestedAggregates(t *testing.T) {
	knownAggregate := uuid.New()
	knownEvent := uuid.New()
	unknownAggregate := uuid.New()

	repo := &stubEventRepository{
		findKnownEventIDs: func(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error) {
			assert.ElementsMatch(t, []uuid.UUID{knownAggregate, unknownAggregate}, aggregateIDs)
			return []uuid.UUID{knownEvent}, nil
		},
	}

	e := echo.New()
	NewSyncStateController(e, repo)

	body := fmt.Sprintf(`{"aggregate_ids":["%s","%s"]}`, knownAggregate, unknownAggregate)
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
	NewSyncStateController(e, repo)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncStateController_TooManyAggregateIDsReturns400(t *testing.T) {
	repo := &stubEventRepository{}
	e := echo.New()
	NewSyncStateController(e, repo)

	ids := make([]string, maxSyncStateAggregateIDs+1)
	for i := range ids {
		ids[i] = fmt.Sprintf(`"%s"`, uuid.New())
	}
	body := fmt.Sprintf(`{"aggregate_ids":[%s]}`, strings.Join(ids, ","))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSyncStateController_RepositoryErrorReturns500(t *testing.T) {
	repo := &stubEventRepository{
		findKnownEventIDs: func(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error) {
			return nil, assert.AnError
		},
	}
	e := echo.New()
	NewSyncStateController(e, repo)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"aggregate_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestSyncStateController_EmptyAggregateIDsReturnsEmptyList(t *testing.T) {
	repo := &stubEventRepository{
		findKnownEventIDs: func(ctx context.Context, aggregateIDs []uuid.UUID) ([]uuid.UUID, error) {
			return nil, nil
		},
	}
	e := echo.New()
	NewSyncStateController(e, repo)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/state", strings.NewReader(`{"aggregate_ids":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"known_event_ids":[]}`, rec.Body.String())
}
