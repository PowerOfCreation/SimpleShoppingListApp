package services

import (
	"context"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ToDoListService struct {
	todoListRepository repositories.ToDoListRepository
}

func NewToDoListService(
	todoListRepository repositories.ToDoListRepository,
) interfaces.ToDoListService {
	return &ToDoListService{
		todoListRepository: todoListRepository,
	}
}

func (s *ToDoListService) CreateToDoList(ctx context.Context, todoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error) {
	newToDoList := entities.NewToDoListAt(todoListCommand.Id, todoListCommand.Name, todoListCommand.OccurredAt)

	validatedToDoList, err := entities.NewValidatedToDoList(newToDoList)
	if err != nil {
		// A validation failure (e.g. empty name) will fail identically on
		// every retry - not a transient failure, see interfaces.ErrPermanent.
		// Only this error is wrapped; a repository error below is left as-is
		// since it may well be transient (e.g. a DB connection blip).
		return nil, interfaces.Permanent(err)
	}

	if err := s.todoListRepository.Create(ctx, validatedToDoList, todoListCommand.AtSeq); err != nil {
		return nil, err
	}

	result := command.CreateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}

// UpdateToDoList never reads the row first - todo_lists is a derived
// projection, not the authority, so a missing or already-deleted row is
// never an error (see UpdateToDoList in sql/queries/todo-lists.sql, which
// silently affects zero rows in that case). CreatedAt here is a synthetic
// stand-in purely to satisfy validate(); the UPDATE only ever touches
// name/updated_at, so it never actually reaches storage.
func (s *ToDoListService) UpdateToDoList(ctx context.Context, todoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error) {
	toDoList := entities.NewToDoListAt(todoListCommand.Id, todoListCommand.Name, todoListCommand.OccurredAt)

	validatedToDoList, err := entities.NewValidatedToDoList(toDoList)
	if err != nil {
		// See the identical comment in CreateToDoList.
		return nil, interfaces.Permanent(err)
	}

	if err := s.todoListRepository.Update(ctx, validatedToDoList, todoListCommand.AtSeq); err != nil {
		return nil, err
	}

	result := command.UpdateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}

// DeleteToDoList never reads the row first, for the same reason as
// UpdateToDoList: a missing row just means the tombstone lands with no
// prior state to overwrite. The delete itself is idempotent (see
// DeleteToDoList in sql/queries/todo-lists.sql).
func (s *ToDoListService) DeleteToDoList(ctx context.Context, todoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error) {
	if err := s.todoListRepository.Delete(ctx, todoListCommand.Id, todoListCommand.OccurredAt, todoListCommand.AtSeq); err != nil {
		return nil, err
	}

	result := command.DeleteToDoListCommandResult{
		Success: true,
	}

	return &result, nil
}
