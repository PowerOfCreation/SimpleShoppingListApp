package services

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
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

func (h *DeleteToDoListEventHandler) Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error {
	_, err := h.service.DeleteToDoList(&command.DeleteToDoListCommand{
		Id: aggregateID,
	})
	return err
}
