package command

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
)

type UpdateToDoListCommand struct {
	IdempotencyKey string
	Id             uuid.UUID
	Name           string
}

type UpdateToDoListCommandResult struct {
	Result *common.ToDoListResult
}
