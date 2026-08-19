package rest

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
)

const (
	// maxEventPayloadBytes bounds a single event's payload. A shopping-list
	// event payload (a list/item name, maybe a short note) is realistically
	// well under 1 KB; this leaves generous headroom for legitimate use
	// while still bounding a malformed or hostile payload.
	maxEventPayloadBytes = 8 * 1024
	// maxBatchPayloadBytes bounds a batch's combined payload size. The
	// client flushes at most 50 events per push (see
	// OutboxRepository.getPending's default page size), so this comfortably
	// covers even a large offline backlog of normal-sized events without
	// allowing an unbounded batch.
	maxBatchPayloadBytes = 64 * 1024

	// todoListEventTypePrefix marks events whose aggregate *is* the list
	// (see events.EventTypeCreateToDoList and friends) - only for these is
	// an aggregate_id addressing a different list a structural error.
	todoListEventTypePrefix = "todo_list."
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
//
// validateEventStructure runs before authorization: it's a cheap, local
// check of the envelope only (never the payload's fields, see its own
// comment) - like git fsck, not a content review - so it rejects a
// malformed batch before spending a DB round-trip on it.
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
	if err := validateEventStructure(events); err != nil {
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

// validateEventStructure enforces the envelope-only rules the server may
// check without parsing payload content: event_id/aggregate_id must be
// real UUIDs, a todo_list.* event's aggregate_id must equal its own
// list_id (list_id itself is already required by distinctListIDs, called
// before this), payload must be syntactically valid JSON, and both
// per-event and per-batch payload size stay bounded. It deliberately never
// looks at a field inside payload - an unknown event_type or a semantically
// invalid payload (e.g. an empty name) is not this function's concern, see
// SyncEvents's doc comment.
func validateEventStructure(events []request.SyncEventRequest) error {
	var batchBytes int
	for _, event := range events {
		if event.EventID == uuid.Nil {
			return fmt.Errorf("event_id is required")
		}
		if event.AggregateID == uuid.Nil {
			return fmt.Errorf("aggregate_id is required")
		}
		if strings.HasPrefix(event.EventType, todoListEventTypePrefix) && event.AggregateID != *event.ListID {
			return fmt.Errorf("event %s: aggregate_id must equal list_id for %s events", event.EventID, event.EventType)
		}
		if len(event.Payload) > maxEventPayloadBytes {
			return fmt.Errorf("event %s: payload exceeds %d bytes", event.EventID, maxEventPayloadBytes)
		}
		if !json.Valid(event.Payload) {
			return fmt.Errorf("event %s: payload is not valid JSON", event.EventID)
		}
		batchBytes += len(event.Payload)
		if batchBytes > maxBatchPayloadBytes {
			return fmt.Errorf("batch payload exceeds %d bytes", maxBatchPayloadBytes)
		}
	}
	return nil
}
