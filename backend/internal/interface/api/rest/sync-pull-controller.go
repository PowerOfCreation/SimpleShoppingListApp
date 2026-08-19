package rest

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

const (
	defaultPullLimit = 200
	maxPullLimit     = 500
)

type SyncPullController struct {
	logger    *slog.Logger
	eventRepo repositories.EventRepository
	access    interfaces.ListAccessService
}

func NewSyncPullController(
	e *echo.Echo,
	logger *slog.Logger,
	eventRepo repositories.EventRepository,
	access interfaces.ListAccessService,
	authMW echo.MiddlewareFunc,
) *SyncPullController {
	controller := &SyncPullController{logger: logger, eventRepo: eventRepo, access: access}
	e.POST("/api/v1/sync/head", controller.GetHead, authMW)
	e.GET("/api/v1/sync/events", controller.GetEvents, authMW)
	return controller
}

// GetHead reports, for each requested list the caller is a member of, the
// server's current pull cursor (seq + latest event id). The client compares
// this against its own locally stored cursor to decide whether to pull,
// push, or do nothing (see the frontend's SyncEngine.pull decision table).
// POST rather than GET so the list of ids doesn't have to fit in a query
// string - maxPullLimit's sibling cap (maxSyncListIDs, defined in
// sync-state-controller.go) applies here too, reused rather than duplicated
// since both endpoints bound the same kind of request.
func (spc *SyncPullController) GetHead(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

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

	ctx := c.Request().Context()
	accessibleIDs, err := spc.access.FilterAccessible(ctx, userID, req.ListIDs)
	if err != nil {
		middleware.RequestScopedLogger(spc.logger, c).Error("failed to filter accessible lists", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to look up list heads",
		})
	}

	heads, err := spc.eventRepo.FindListHeads(ctx, accessibleIDs)
	if err != nil {
		middleware.RequestScopedLogger(spc.logger, c).Error("failed to look up list heads", "list_ids", accessibleIDs, "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to look up list heads",
		})
	}

	byListID := make(map[uuid.UUID]*repositories.ListHead, len(heads))
	for _, h := range heads {
		byListID[h.ListID] = h
	}

	accessible := make(map[uuid.UUID]struct{}, len(accessibleIDs))
	for _, id := range accessibleIDs {
		accessible[id] = struct{}{}
	}

	// Every requested id still gets an entry, so the client can't tell "the
	// server forgot to answer" from "not accessible". A list the caller
	// isn't a member of is indistinguishable here from one the server has
	// never heard of (both resolve to seq 0, event_id nil) - deliberately:
	// this is a read path and must not become an oracle for "that id
	// exists but isn't yours" (see ListAccessService.FilterAccessible).
	responseHeads := make([]response.ListHeadResponse, len(req.ListIDs))
	for i, listID := range req.ListIDs {
		if _, ok := accessible[listID]; !ok {
			responseHeads[i] = response.ListHeadResponse{ListID: listID, Seq: 0, EventID: nil}
			continue
		}
		if h, ok := byListID[listID]; ok {
			responseHeads[i] = response.ListHeadResponse{ListID: listID, Seq: h.Seq, EventID: h.EventID}
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
// need two parsers. Unlike GetHead, a single list_id here is a normal
// parameter, not a batch to filter - a caller who isn't a member gets 403
// outright, since there's no ambiguity across other ids to hide behind.
func (spc *SyncPullController) GetEvents(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	listID, err := uuid.Parse(c.QueryParam("list_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "list_id is required and must be a valid uuid",
		})
	}

	ctx := c.Request().Context()
	if err := spc.access.RequireRead(ctx, userID, listID); err != nil {
		if errors.Is(err, interfaces.ErrListAccessDenied) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "caller does not have access to this list",
			})
		}
		middleware.RequestScopedLogger(spc.logger, c).Error("failed to authorize list read", "list_id", listID, "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load events",
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

	events, err := spc.eventRepo.FindEventsSince(ctx, listID, sinceSeq, limit)
	if err != nil {
		middleware.RequestScopedLogger(spc.logger, c).Error(
			"failed to load events", "list_id", listID, "since_seq", sinceSeq, "error", err,
		)
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
