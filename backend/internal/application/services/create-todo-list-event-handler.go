package services

import (
	"context"
	"encoding/json"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type CreateToDoListEventHandler struct {
	service interfaces.ToDoListService
}

func NewCreateToDoListEventHandler(service interfaces.ToDoListService) *CreateToDoListEventHandler {
	return &CreateToDoListEventHandler{service: service}
}

func (h *CreateToDoListEventHandler) EventType() string {
	return events.EventTypeCreateToDoList
}

func (h *CreateToDoListEventHandler) Handle(ctx context.Context, storedEvent *repositories.StoredEvent) error {
	var event events.CreateToDoListEvent
	if err := json.Unmarshal(storedEvent.Payload, &event); err != nil {
		return err
	}

	_, err := h.service.CreateToDoList(ctx, &command.CreateToDoListCommand{
		Id:         storedEvent.AggregateID,
		Name:       event.Name,
		OccurredAt: storedEvent.OccurredAt,
	})
	return err
}
