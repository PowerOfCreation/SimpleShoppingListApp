package interfaces

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
)

type ToDoListService interface {
	CreateToDoList(toDoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error)
	UpdateToDoList(toDoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error)
	DeleteToDoList(toDoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error)
}
