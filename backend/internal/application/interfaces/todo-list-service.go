package interfaces

import (
	"context"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
)

type ToDoListService interface {
	CreateToDoList(ctx context.Context, toDoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error)
	UpdateToDoList(ctx context.Context, toDoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error)
	DeleteToDoList(ctx context.Context, toDoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error)
	// RebuildList replays a list's full event history, seq-ascending, and
	// rebuilds its todo_lists projection from scratch inside a single
	// transaction. Not wired to any route yet - it's the foundation for the
	// unsync endpoint (separate PR).
	RebuildList(ctx context.Context, listID uuid.UUID) error
}
