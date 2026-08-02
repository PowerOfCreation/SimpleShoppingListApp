package rest

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

// Caps how many list ids a single request can ask about, so a client with
// an unusually large number of synced lists can't send an unbounded
// request body. The frontend is expected to page/chunk beyond this (see
// SyncClient.getKnownEventIds). Shared with SyncPullController.GetHead -
// both endpoints bound the same kind of request.
const maxSyncListIDs = 200

type SyncStateController struct {
	eventRepo repositories.EventRepository
}

func NewSyncStateController(
	e *echo.Echo,
	eventRepo repositories.EventRepository,
	authMW echo.MiddlewareFunc,
) *SyncStateController {
	controller := &SyncStateController{eventRepo: eventRepo}
	e.POST("/api/v1/sync/state", controller.GetSyncState, authMW)
	return controller
}

// GetSyncState is the self-heal / reconcile endpoint: for a set of list
// ids, reports which of their events this server has durably processed.
// The frontend resets anything it believed was synced but that doesn't
// show up here back to pending so it gets resent - this is what recovers
// from a lost ack, an app kill between send and ack, or the server losing
// data it had previously acked.
func (ssc *SyncStateController) GetSyncState(c echo.Context) error {
	var req request.SyncStateRequest
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

	knownEventIDs, err := ssc.eventRepo.FindKnownEventIDsByList(c.Request().Context(), req.ListIDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to look up sync state",
		})
	}
	// A nil slice would serialize as JSON null rather than [] - normalize
	// so the response shape is always an array regardless of what the
	// repository implementation happens to return for "none".
	if knownEventIDs == nil {
		knownEventIDs = []uuid.UUID{}
	}

	return c.JSON(http.StatusOK, response.SyncStateResponse{KnownEventIDs: knownEventIDs})
}
