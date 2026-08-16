package services

import (
	"context"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type DeleteToDoListEventHandler struct {
	service interfaces.ToDoListService
}

func NewDeleteToDoListEventHandler(service interfaces.ToDoListService) *DeleteToDoListEventHandler {
	return &DeleteToDoListEventHandler{service: service}
}

func (h *DeleteToDoListEventHandler) EventType() string {
	return events.EventTypeDeleteToDoList
}

func (h *DeleteToDoListEventHandler) Handle(ctx context.Context, storedEvent *repositories.StoredEvent) error {
	_, err := h.service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{
		Id:         storedEvent.AggregateID,
		OccurredAt: storedEvent.OccurredAt,
	})
	return err
}
