package rest

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// NewListMembersController exposes identity and first name, including the owner.
func NewListMembersController(e *echo.Echo, logger *slog.Logger, service interfaces.ListMembersService, authMW echo.MiddlewareFunc) {
	e.GET("/api/v1/todo-lists/:listId/members", func(c echo.Context) error {
		userID, ok := middleware.UserIDFromContext(c)
		if !ok {
			return unauthorized(c)
		}
		listID, err := uuid.Parse(c.Param("listId"))
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "listId must be a valid uuid"})
		}
		profiles, err := service.FindMembers(c.Request().Context(), userID, listID)
		if errors.Is(err, interfaces.ErrListAccessDenied) {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "caller does not have access to this list"})
		}
		if err != nil {
			middleware.RequestScopedLogger(logger, c).Error("failed to list members", "error", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		}
		type memberResponse struct {
			UserID    string `json:"user_id"`
			FirstName string `json:"first_name"`
		}
		members := make([]memberResponse, 0, len(profiles))
		for _, p := range profiles {
			members = append(members, memberResponse{UserID: p.UserID(), FirstName: p.FirstName()})
		}
		c.Response().Header().Set("Cache-Control", "no-store")
		return c.JSON(http.StatusOK, struct {
			Members []memberResponse `json:"members"`
		}{Members: members})
	}, authMW)
}
