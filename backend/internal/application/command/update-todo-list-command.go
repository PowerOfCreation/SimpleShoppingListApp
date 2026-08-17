package command

import (
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type UpdateToDoListCommand struct {
	IdempotencyKey string
	Id             uuid.UUID
	Name           string
	OccurredAt     time.Time
	// AtSeq is the originating event's log position - see ToDoListRepository.
	AtSeq int64
}

type UpdateToDoListCommandResult struct {
	Result *common.ToDoListResult
}
