package command

import (
	"time"

	"github.com/google/uuid"
)

type DeleteToDoListCommand struct {
	Id         uuid.UUID
	OccurredAt time.Time
}

type DeleteToDoListCommandResult struct {
	Success bool
}
