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

type DeleteToDoListEventHandler struct {
	service interfaces.ToDoListService
}

func NewDeleteToDoListEventHandler(service interfaces.ToDoListService) *DeleteToDoListEventHandler {
	return &DeleteToDoListEventHandler{service: service}
}

func (h *DeleteToDoListEventHandler) EventType() string {
	return events.EventTypeDeleteToDoList
}

func (h *DeleteToDoListEventHandler) Handle(ctx context.Context, aggregateID uuid.UUID, occurredAt time.Time, payload json.RawMessage) error {
	_, err := h.service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{
		Id:         aggregateID,
		OccurredAt: occurredAt,
	})
	return err
}
