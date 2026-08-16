package services

import (
	"context"
	"encoding/json"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type UpdateToDoListEventHandler struct {
	service interfaces.ToDoListService
}

func NewUpdateToDoListEventHandler(service interfaces.ToDoListService) *UpdateToDoListEventHandler {
	return &UpdateToDoListEventHandler{service: service}
}

func (h *UpdateToDoListEventHandler) EventType() string {
	return events.EventTypeUpdateToDoList
}

func (h *UpdateToDoListEventHandler) Handle(ctx context.Context, storedEvent *repositories.StoredEvent) error {
	var event events.UpdateToDoListEvent
	if err := json.Unmarshal(storedEvent.Payload, &event); err != nil {
		// Malformed payload will fail to unmarshal on every retry - not a
		// transient failure, see interfaces.ErrPermanent.
		return interfaces.Permanent(err)
	}

	_, err := h.service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{
		Id:         storedEvent.AggregateID,
		Name:       event.Name,
		OccurredAt: storedEvent.OccurredAt,
	})
	return err
}
