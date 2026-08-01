package rest

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/realtime"
)

// CheckOrigin is permissive: this is a native-app API with no browser CORS
// concern. Authentication (see internal/interface/api/middleware) covers
// who may connect at all; this only ever gated the browser-only Origin
// check, which doesn't apply to a native client.
var syncUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type SyncWebSocketController struct {
	hub *realtime.Hub
}

func NewSyncWebSocketController(e *echo.Echo, hub *realtime.Hub, authMW echo.MiddlewareFunc) *SyncWebSocketController {
	controller := &SyncWebSocketController{hub: hub}
	e.GET("/api/v1/sync/ws", controller.Connect, authMW)
	return controller
}

// Connect upgrades to a WebSocket and blocks for the connection's entire
// lifetime (see Hub.Serve). client_id stays a query parameter rather than
// becoming the verified identity - the Authorization header (checked by
// authMW before this handler runs) is what's actually trusted now;
// client_id remains purely a routing key for ack fan-out (see
// realtime.Hub), same as before auth existed.
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
