package services

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
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

func (h *CreateToDoListEventHandler) Handle(ctx context.Context, aggregateID uuid.UUID, occurredAt time.Time, payload json.RawMessage) error {
	var event events.CreateToDoListEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return err
	}

	_, err := h.service.CreateToDoList(ctx, &command.CreateToDoListCommand{
		Id:         aggregateID,
		Name:       event.Name,
		OccurredAt: occurredAt,
	})
	return err
}
