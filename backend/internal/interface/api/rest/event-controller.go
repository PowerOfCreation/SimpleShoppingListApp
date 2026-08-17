package rest

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
)

type EventController struct {
	logger   *slog.Logger
	ingestor *services.EventIngestor
	access   interfaces.ListAccessService
}

func NewEventController(
	e *echo.Echo,
	logger *slog.Logger,
	ingestor *services.EventIngestor,
	access interfaces.ListAccessService,
	authMW echo.MiddlewareFunc,
) *EventController {
	controller := &EventController{logger: logger, ingestor: ingestor, access: access}
	e.POST("/api/v1/events", controller.SyncEvents, authMW)
	return controller
}

// SyncEvents authorizes the whole batch synchronously, then only enqueues
// events for background processing and returns 202 - it does not wait for
// them to be written to the database. Authorization has to happen here, not
// in the ingestor: the ingestor's worker runs on a background goroutine
// with no HTTP request context, so the verified caller identity
// (middleware.UserIDFromContext) is only ever available at this point (see
// sync-sharing-target.md 7.1). The whole batch is checked before anything
// is enqueued - a rejected list must not have some of its events silently
// accepted just because they arrived interleaved with an authorized list's.
//
// Once authorized, each event is still enqueued independently, so one
// client sending a batch containing an event the server doesn't understand
// yet no longer poisons the events behind it (see EventDispatcher's
// forward-compatible unknown-type handling and EventIngestor's per-event
// processing).
func (ec *EventController) SyncEvents(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	var events []request.SyncEventRequest
	if err := c.Bind(&events); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	ctx := c.Request().Context()

	listIDs, err := distinctListIDs(events)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}
	if err := ec.access.AuthorizeWrite(ctx, userID, listIDs); err != nil {
		if errors.Is(err, interfaces.ErrListAccessDenied) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "caller does not have access to this list",
			})
		}
		middleware.RequestScopedLogger(ec.logger, c).Error("failed to authorize event batch", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to authorize event batch",
		})
	}

	for _, event := range events {
		if err := ec.ingestor.Enqueue(ctx, event.ToStoredEvent(userID)); err != nil {
			middleware.RequestScopedLogger(ec.logger, c).Error("failed to queue event", "event_id", event.EventID, "error", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to queue event",
			})
		}
	}

	return c.JSON(http.StatusAccepted, map[string]int{"queued": len(events)})
}

// distinctListIDs collects every event's list_id, deduplicated, and rejects
// the batch if any event is missing one. An event without a list_id isn't
// scopable to a list_members check, so it can no longer be accepted at all
// - unlike ListID on repositories.StoredEvent, which stays a pointer for
// older stored rows, every event on the wire from here on must carry one.
func distinctListIDs(events []request.SyncEventRequest) ([]uuid.UUID, error) {
	seen := make(map[uuid.UUID]struct{}, len(events))
	ids := make([]uuid.UUID, 0, len(events))
	for _, event := range events {
		if event.ListID == nil {
			return nil, errors.New("list_id is required")
		}
		if _, ok := seen[*event.ListID]; ok {
			continue
		}
		seen[*event.ListID] = struct{}{}
		ids = append(ids, *event.ListID)
	}
	return ids, nil
}
