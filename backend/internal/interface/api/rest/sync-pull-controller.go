package rest

import (
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

const (
	defaultPullLimit = 200
	maxPullLimit     = 500
)

type SyncPullController struct {
	eventRepo repositories.EventRepository
}

func NewSyncPullController(e *echo.Echo, eventRepo repositories.EventRepository) *SyncPullController {
	controller := &SyncPullController{eventRepo: eventRepo}
	e.POST("/api/v1/sync/head", controller.GetHead)
	e.GET("/api/v1/sync/events", controller.GetEvents)
	return controller
}

// GetHead reports, for each requested list, the server's current pull
// cursor (seq + latest event id). The client compares this against its own
// locally stored cursor to decide whether to pull, push, or do nothing
// (see the frontend's SyncEngine.pull decision table). POST rather than
// GET so the list of ids doesn't have to fit in a query string - maxPullLimit's
// sibling cap (maxSyncListIDs, defined in sync-state-controller.go) applies
// here too, reused rather than duplicated since both endpoints bound the
// same kind of request.
func (spc *SyncPullController) GetHead(c echo.Context) error {
	var req request.SyncHeadRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	if len(req.ListIDs) > maxSyncListIDs {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "too many list_ids in one request",
		})
	}

	heads, err := spc.eventRepo.FindListHeads(c.Request().Context(), req.ListIDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to look up list heads",
		})
	}

	byListID := make(map[uuid.UUID]*repositories.ListHead, len(heads))
	for _, h := range heads {
		byListID[h.ListID] = h
	}

	// Every requested id gets an entry, even a list the server has never
	// heard of (seq 0, event_id nil) - otherwise the client can't tell
	// "unknown to the server" from "the response happened to omit it".
	responseHeads := make([]response.ListHeadResponse, len(req.ListIDs))
	for i, listID := range req.ListIDs {
		if h, ok := byListID[listID]; ok {
			eventID := h.EventID
			responseHeads[i] = response.ListHeadResponse{ListID: listID, Seq: h.Seq, EventID: &eventID}
		} else {
			responseHeads[i] = response.ListHeadResponse{ListID: listID, Seq: 0, EventID: nil}
		}
	}

	return c.JSON(http.StatusOK, response.SyncHeadResponse{Heads: responseHeads})
}

// GetEvents returns one page of a list's event history, strictly ordered
// by seq and starting after since_seq - the pull endpoint proper. Push
// (POST /api/v1/events) and pull share the exact same wire event shape
// (see mapper.ToSyncEventResponse), so the frontend's apply path doesn't
// need two parsers.
func (spc *SyncPullController) GetEvents(c echo.Context) error {
	listID, err := uuid.Parse(c.QueryParam("list_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "list_id is required and must be a valid uuid",
		})
	}

	sinceSeq := int64(0)
	if raw := c.QueryParam("since_seq"); raw != "" {
		sinceSeq, err = strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "since_seq must be an integer",
			})
		}
	}

	limit := int32(defaultPullLimit)
	if raw := c.QueryParam("limit"); raw != "" {
		parsed, parseErr := strconv.ParseInt(raw, 10, 32)
		if parseErr != nil || parsed <= 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "limit must be a positive integer",
			})
		}
		limit = int32(parsed)
	}
	if limit > maxPullLimit {
		limit = maxPullLimit
	}

	events, err := spc.eventRepo.FindEventsSince(c.Request().Context(), listID, sinceSeq, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load events",
		})
	}

	// has_more is a heuristic (a full page implies more might follow), not
	// a second count query - a page that happens to end exactly on the
	// last available event costs one extra empty round trip, which is
	// cheap and rare compared to counting on every page.
	nextSeq := sinceSeq
	if len(events) > 0 {
		nextSeq = events[len(events)-1].Seq
	}

	return c.JSON(http.StatusOK, response.SyncEventsResponse{
		ListID:  listID,
		Events:  mapper.ToSyncEventResponseList(events),
		NextSeq: nextSeq,
		HasMore: int32(len(events)) == limit,
	})
}
