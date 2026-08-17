package rest

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/realtime"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
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
// lifetime (see Hub.Serve). Routing is keyed by the verified user_id from
// the Authorization header (checked by authMW before this handler runs),
// not the client_id query parameter - a query param is client-supplied and
// unverified, so trusting it as a fan-out key would let a connection
// receive acks for events it never sent by simply guessing someone else's
// client_id. The query param is no longer required; if present, it's
// ignored.
func (swc *SyncWebSocketController) Connect(c echo.Context) error {
	userID, ok := middleware.UserIDFromContext(c)
	if !ok {
		return unauthorized(c)
	}

	ws, err := syncUpgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}

	swc.hub.Serve(c.Request().Context(), userID, ws)
	return nil
}
