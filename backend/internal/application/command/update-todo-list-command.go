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
}

type UpdateToDoListCommandResult struct {
	Result *common.ToDoListResult
}
