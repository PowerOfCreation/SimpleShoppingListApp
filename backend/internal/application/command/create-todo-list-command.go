package command

import (
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type CreateToDoListCommand struct {
	IdempotencyKey string
	Id             uuid.UUID
	Name           string
	OccurredAt     time.Time
}

type CreateToDoListCommandResult struct {
	Result *common.ToDoListResult
}
