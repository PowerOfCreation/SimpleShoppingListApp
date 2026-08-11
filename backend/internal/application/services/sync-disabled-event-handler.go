package services

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
)

// SyncDisabledEventHandler deletes the list when its owner turns sync off
// for it. The frontend's own copy lives in a device-local table
// (list_sync_settings), never in the replayed event log, so this event
// only ever reaches the backend - see
// frontend/docs/sync-design-decisions.md.
type SyncDisabledEventHandler struct {
	service interfaces.ToDoListService
}

func NewSyncDisabledEventHandler(service interfaces.ToDoListService) *SyncDisabledEventHandler {
	return &SyncDisabledEventHandler{service: service}
}

func (h *SyncDisabledEventHandler) EventType() string {
	return events.EventTypeSyncDisabled
}

func (h *SyncDisabledEventHandler) Handle(ctx context.Context, aggregateID uuid.UUID, payload json.RawMessage) error {
	_, err := h.service.DeleteToDoList(&command.DeleteToDoListCommand{
		Id: aggregateID,
	})
	return err
}
