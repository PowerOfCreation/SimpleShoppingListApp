package rest

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

type ListSharingController struct {
	logger  *slog.Logger
	service interfaces.ListSharingService
}

func NewListSharingController(
	e *echo.Echo,
	logger *slog.Logger,
	service interfaces.ListSharingService,
	authMW echo.MiddlewareFunc,
) *ListSharingController {
	controller := &ListSharingController{logger: logger, service: service}
	e.POST("/api/v1/todo-lists/:listId/invites", controller.CreateInvite, authMW)
	e.GET("/api/v1/todo-lists/:listId/invites", controller.GetInvites, authMW)
	e.DELETE("/api/v1/invites/:inviteId", controller.RevokeInvite, authMW)
	e.POST("/api/v1/invites/redeem", controller.RedeemInvite, authMW)
	return controller
}

func (lsc *ListSharingController) CreateInvite(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	listID, err := uuid.Parse(c.Param("listId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "listId must be a valid uuid",
		})
	}

	var req request.CreateListInviteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	result, err := lsc.service.CreateInvite(c.Request().Context(), &command.CreateListInviteCommand{
		ListID: listID,
		UserID: userID,
		TTLKey: req.TTL,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to create invite")
	}

	return c.JSON(http.StatusCreated, mapper.ToCreateListInviteResponse(result))
}

func (lsc *ListSharingController) GetInvites(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	listID, err := uuid.Parse(c.Param("listId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "listId must be a valid uuid",
		})
	}

	result, err := lsc.service.FindActiveInvites(c.Request().Context(), &query.GetListInvitesQuery{
		ListID: listID,
		UserID: userID,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to list invites")
	}

	return c.JSON(http.StatusOK, response.ListInvitesResponse{
		Invites: mapper.ToListInviteResponseList(result.Result),
	})
}

func (lsc *ListSharingController) RevokeInvite(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	inviteID, err := uuid.Parse(c.Param("inviteId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "inviteId must be a valid uuid",
		})
	}

	if _, err := lsc.service.RevokeInvite(c.Request().Context(), &command.RevokeListInviteCommand{
		InviteID: inviteID,
		UserID:   userID,
	}); err != nil {
		return lsc.errorResponse(c, err, "failed to revoke invite")
	}

	return c.NoContent(http.StatusNoContent)
}

func (lsc *ListSharingController) RedeemInvite(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	var req request.RedeemListInviteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	result, err := lsc.service.RedeemInvite(c.Request().Context(), &command.RedeemListInviteCommand{
		Token:  req.Token,
		UserID: userID,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to redeem invite")
	}

	return c.JSON(http.StatusOK, mapper.ToRedeemListInviteResponse(result))
}

func unauthorized(c echo.Context) error {
	return c.JSON(http.StatusUnauthorized, map[string]string{
		"error": "missing user identity",
	})
}

// errorResponse maps a ListSharingService sentinel error to its HTTP
// status; anything unrecognized is logged and collapsed to 500 rather than
// leaking internals. errors.Is, not ==, since CreateInvite wraps
// ErrInvalidInviteTTL with the offending key via fmt.Errorf("%w: ...").
func (lsc *ListSharingController) errorResponse(c echo.Context, err error, logMsg string) error {
	status, message := errorStatus(err)
	if status == http.StatusInternalServerError {
		middleware.RequestScopedLogger(lsc.logger, c).Error(logMsg, "error", err)
	}
	return c.JSON(status, map[string]string{"error": message})
}

func errorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, interfaces.ErrListNotFound):
		return http.StatusNotFound, "todo list not found"
	case errors.Is(err, interfaces.ErrInviteNotFound):
		return http.StatusNotFound, "invite not found"
	case errors.Is(err, interfaces.ErrNotAListMember):
		return http.StatusForbidden, "caller is not a member of this list"
	case errors.Is(err, interfaces.ErrInviteNotRevocable):
		return http.StatusForbidden, "caller may not revoke this invite"
	case errors.Is(err, interfaces.ErrInviteExpired):
		return http.StatusGone, "invite has expired"
	case errors.Is(err, interfaces.ErrInviteRevoked):
		return http.StatusGone, "invite has been revoked"
	case errors.Is(err, interfaces.ErrInvalidInviteTTL):
		return http.StatusBadRequest, "invalid invite ttl"
	default:
		return http.StatusInternalServerError, "Internal server error"
	}
}
