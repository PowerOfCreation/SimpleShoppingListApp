package command

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type CreateToDoListCommand struct {
	IdempotencyKey string
	Id             uuid.UUID
	Name           string
}

type CreateToDoListCommandResult struct {
	Result *common.ToDoListResult
}
