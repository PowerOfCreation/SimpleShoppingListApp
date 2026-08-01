package command

import (
	"github.com/google/uuid"
)

type DeleteToDoListCommand struct {
	Id uuid.UUID
}

type DeleteToDoListCommandResult struct {
	Success bool
}
