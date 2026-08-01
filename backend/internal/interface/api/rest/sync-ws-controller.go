package rest

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/realtime"
)

// CheckOrigin is permissive: this is a native-app API with no browser CORS
// concern today, and there is no user auth yet to check against (see
// docs/keycloak-login.md's "Open issues" on the frontend side). Revisit
// once the backend verifies the Keycloak token.
var syncUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type SyncWebSocketController struct {
	hub *realtime.Hub
}

func NewSyncWebSocketController(e *echo.Echo, hub *realtime.Hub) *SyncWebSocketController {
	controller := &SyncWebSocketController{hub: hub}
	e.GET("/api/v1/sync/ws", controller.Connect)
	return controller
}

// Connect upgrades to a WebSocket and blocks for the connection's entire
// lifetime (see Hub.Serve). client_id is a query parameter rather than a
// header because the WebSocket handshake is a plain GET - there is no
// custom-header story here without user auth to piggyback on; once
// requests carry a verified user/session, this becomes the identity
// instead.
func (swc *SyncWebSocketController) Connect(c echo.Context) error {
	clientID := c.QueryParam("client_id")
	if clientID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "client_id is required",
		})
	}

	ws, err := syncUpgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}

	swc.hub.Serve(clientID, ws)
	return nil
}
