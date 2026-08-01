package services

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
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

func (h *UpdateToDoListEventHandler) Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error {
	var event events.UpdateToDoListEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return err
	}

	_, err := h.service.UpdateToDoList(&command.UpdateToDoListCommand{
		Id:   aggregateID,
		Name: event.Name,
	})
	return err
}
