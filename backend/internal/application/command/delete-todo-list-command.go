package command

import (
	"time"

	"github.com/google/uuid"
)

type DeleteToDoListCommand struct {
	Id         uuid.UUID
	OccurredAt time.Time
	// AtSeq is the originating event's log position - see ToDoListRepository.
	AtSeq int64
}

type DeleteToDoListCommandResult struct {
	Success bool
}
