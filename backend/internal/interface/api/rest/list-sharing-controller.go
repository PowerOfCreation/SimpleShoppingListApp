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

// maxInviteListNameBytes bounds the client-supplied list-name snapshot
// (see entities.ListInvite.ListName). List names are realistically well
// under this; it exists to stop an invite row (and every future preview/
// redeem response for it) from growing unbounded.
const maxInviteListNameBytes = 200

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
	e.POST("/api/v1/invites/preview", controller.PreviewInvite, authMW)
	e.GET("/api/v1/todo-lists", controller.GetMyLists, authMW)
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
	if len(req.ListName) > maxInviteListNameBytes {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "list_name is too long",
		})
	}

	createdByName, createdByPictureURL := middleware.UserProfileFromContext(c)
	result, err := lsc.service.CreateInvite(c.Request().Context(), &command.CreateListInviteCommand{
		ListID:              listID,
		UserID:              userID,
		TTLKey:              req.TTL,
		ListName:            req.ListName,
		CreatedByName:       createdByName,
		CreatedByPictureURL: createdByPictureURL,
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

	token, err := bindInviteToken(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	result, err := lsc.service.RedeemInvite(c.Request().Context(), &command.RedeemListInviteCommand{
		Token:  token,
		UserID: userID,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to redeem invite")
	}

	return c.JSON(http.StatusOK, mapper.ToRedeemListInviteResponse(result))
}

// PreviewInvite resolves a token without joining - authenticated (like every
// sharing route), but it never touches list_members, so it's safe to call
// repeatedly (e.g. before showing an "accept invite" screen).
func (lsc *ListSharingController) PreviewInvite(c echo.Context) error {
	if _, ok := middleware.UserIDFromContext(c); !ok {
		return unauthorized(c)
	}

	token, err := bindInviteToken(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	result, err := lsc.service.PreviewInvite(c.Request().Context(), &query.PreviewInviteQuery{
		Token: token,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to preview invite")
	}

	return c.JSON(http.StatusOK, mapper.ToInvitePreviewResponse(result))
}

// bindInviteToken parses the {token} body shared by RedeemInvite and
// PreviewInvite and rejects an empty one - a blank token must not reach the
// service, where hashing "" and looking it up would surface as
// ErrInviteNotFound (404), conflating a missing request field with a
// genuinely unknown invite. Callers turn a non-nil error into a 400 with
// its message; nothing here writes to the response itself.
func bindInviteToken(c echo.Context) (string, error) {
	var req request.RedeemListInviteRequest
	if err := c.Bind(&req); err != nil {
		return "", errors.New("Failed to parse request body")
	}
	if req.Token == "" {
		return "", errors.New("token must not be empty")
	}
	return req.Token, nil
}

func (lsc *ListSharingController) GetMyLists(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	result, err := lsc.service.FindMyLists(c.Request().Context(), &query.GetMyListsQuery{
		UserID: userID,
	})
	if err != nil {
		return lsc.errorResponse(c, err, "failed to list my lists")
	}

	return c.JSON(http.StatusOK, mapper.ToMyListsResponse(result))
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
	case errors.Is(err, interfaces.ErrNotListOwner):
		return http.StatusForbidden, "caller is not the owner of this list"
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
