package rest

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
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
	// ("todo_list.created" and friends) - only for these is an aggregate_id
	// addressing a different list a structural error. Matched as a prefix,
	// not against a known-type list: an unknown todo_list.* type is still
	// accepted and relayed (R2), it just has to address its own list.
	todoListEventTypePrefix = "todo_list."
)

type EventController struct {
	logger    *slog.Logger
	eventRepo repositories.EventRepository
	access    interfaces.ListAccessService
	publisher interfaces.ListEventPublisher
}

func NewEventController(
	e *echo.Echo,
	logger *slog.Logger,
	eventRepo repositories.EventRepository,
	access interfaces.ListAccessService,
	publisher interfaces.ListEventPublisher,
	authMW echo.MiddlewareFunc,
) *EventController {
	controller := &EventController{logger: logger, eventRepo: eventRepo, access: access, publisher: publisher}
	e.POST("/api/v1/events", controller.SyncEvents, authMW)
	return controller
}

// SyncEvents accepts a batch synchronously and returns only once every
// event is durably in the log: authorize the whole batch (403), validate
// its structure (400), then append it, one transaction per list (see
// EventRepository.AppendToList). Nothing past this point can reject an
// event - once appended it is a fact (R1 in
// frontend/docs/sync-sharing-target.md); there is no background
// worker left that could still say no, so unlike the old enqueue-and-202
// model this genuinely means "stored", not "accepted for later attempt" -
// hence 200, not 202.
//
// The response body is therefore the confirmation: Acked carries every
// event's assigned seq, and nothing is delivered over the WebSocket about
// the caller's own push. A lost response is self-healing rather than
// tracked - the row stays pending client-side, the next flush re-pushes,
// and AppendToList (idempotent on event_id) echoes the same seq back.
//
// Authorization and structural validation both stay whole-batch/fail-closed
// (a rejected list must not have some of its events silently accepted just
// because they arrived interleaved with an authorized list's), but the
// append itself is per list: a mid-batch failure on one list's transaction
// does not roll back another list's already-committed events from the same
// request. That's an acceptable, narrow window - a client retries the
// whole batch on any non-2xx response, and every append is idempotent on
// event_id, so the retry simply re-confirms what already landed.
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

	byList := groupByListID(events, userID)
	now := time.Now().UTC()
	acked := make([]response.SyncEventAckResponse, 0, len(events))

	for _, listID := range listIDs {
		listEvents := byList[listID]
		headSeq, appended, err := ec.eventRepo.AppendToList(ctx, listID, listEvents, now)
		if err != nil {
			middleware.RequestScopedLogger(ec.logger, c).Error("failed to append events", "list_id", listID, "error", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to store events",
			})
		}

		for _, event := range listEvents {
			acked = append(acked, response.SyncEventAckResponse{EventID: event.EventID, Seq: event.Seq})
		}
		// Only notify subscribers if this batch actually added something -
		// a batch that's a pure echo (every event already known, e.g. a
		// redelivered page or our own push looped back) makes nothing newly
		// visible, so there's nothing to pull. A client that missed the
		// notification for the original delivery recovers on its next head
		// check regardless.
		if appended {
			ec.publisher.PublishListEvent(listID, headSeq)
		}
	}

	return c.JSON(http.StatusOK, response.SyncEventsPushResponse{
		Queued: len(events),
		Acked:  acked,
	})
}

// groupByListID buckets events by list_id, preserving each list's relative
// order from the original batch - AppendToList assigns seq in the order it
// receives events, and the client's own outbox already flushes a list's
// events oldest-first, so that order must survive the regrouping.
// distinctListIDs has already rejected any event without a list_id by the
// time this runs.
func groupByListID(events []request.SyncEventRequest, userID string) map[uuid.UUID][]*repositories.StoredEvent {
	byList := make(map[uuid.UUID][]*repositories.StoredEvent)
	for _, event := range events {
		byList[*event.ListID] = append(byList[*event.ListID], event.ToStoredEvent(userID))
	}
	return byList
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
// before this), payload must be present and syntactically valid JSON, and
// both per-event and per-batch payload size stay bounded. It deliberately never
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
		if len(event.Payload) == 0 {
			return fmt.Errorf("event %s: payload is required", event.EventID)
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
