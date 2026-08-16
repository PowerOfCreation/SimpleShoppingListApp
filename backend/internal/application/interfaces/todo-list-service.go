package interfaces

import (
	"context"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
)

type ToDoListService interface {
	CreateToDoList(ctx context.Context, toDoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error)
	UpdateToDoList(ctx context.Context, toDoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error)
	DeleteToDoList(ctx context.Context, toDoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error)
}
