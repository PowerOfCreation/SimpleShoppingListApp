package rest

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
)

type EventController struct {
	ingestor *services.EventIngestor
}

func NewEventController(e *echo.Echo, ingestor *services.EventIngestor) *EventController {
	controller := &EventController{ingestor: ingestor}
	e.POST("/api/v1/events", controller.SyncEvents)
	return controller
}

// SyncEvents only enqueues events for background processing and returns
// 202 - it does not wait for them to be written to the database. This is
// intentional: the client tracks "sent" vs. "durably committed" itself
// (via the WebSocket ack that follows once the ingestor actually processes
// the event), and self-heals via reconcile if an ack never arrives. Each
// event is enqueued independently, so one client sending a batch containing
// an event the server doesn't understand yet no longer poisons the events
// behind it (see EventDispatcher's forward-compatible unknown-type
// handling and EventIngestor's per-event processing).
func (ec *EventController) SyncEvents(c echo.Context) error {
	var events []request.SyncEventRequest
	if err := c.Bind(&events); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	ctx := c.Request().Context()
	for _, event := range events {
		if err := ec.ingestor.Enqueue(ctx, event.ToStoredEvent()); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to queue event",
			})
		}
	}

	return c.JSON(http.StatusAccepted, map[string]int{"queued": len(events)})
}
