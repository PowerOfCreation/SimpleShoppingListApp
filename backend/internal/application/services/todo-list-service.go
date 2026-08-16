package services

import (
	"errors"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ToDoListService struct {
	todoListRepository repositories.ToDoListRepository
	//sellerRepository  repositories.SellerRepository
	//idempotencyRepo   repositories.IdempotencyRepository
}

func NewToDoListService(
	todoListRepository repositories.ToDoListRepository,
	//sellerRepository repositories.SellerRepository,
	//idempotencyRepo repositories.IdempotencyRepository,
) interfaces.ToDoListService {
	return &ToDoListService{
		todoListRepository: todoListRepository,
		//sellerRepository:  sellerRepository,
		//idempotencyRepo:   idempotencyRepo,
	}
}

func (s *ToDoListService) CreateToDoList(todoListCommand *command.CreateToDoListCommand) (*command.CreateToDoListCommandResult, error) {
	var newToDoList = entities.NewToDoList(
		todoListCommand.Id,
		todoListCommand.Name,
	)

	validatedToDoList, err := entities.NewValidatedToDoList(newToDoList)
	if err != nil {
		return nil, err
	}

	_, err = s.todoListRepository.Create(validatedToDoList)
	if err != nil {
		return nil, err
	}

	result := command.CreateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}

func (s *ToDoListService) UpdateToDoList(todoListCommand *command.UpdateToDoListCommand) (*command.UpdateToDoListCommandResult, error) {
	// Find existing todo list
	existingToDoList, err := s.todoListRepository.FindById(todoListCommand.Id)
	if err != nil {
		return nil, err
	}

	if existingToDoList == nil {
		return nil, errors.New("todo list not found")
	}

	// Update product fields
	if err := existingToDoList.UpdateName(todoListCommand.Name); err != nil {
		return nil, err
	}

	validatedToDoList, err := entities.NewValidatedToDoList(existingToDoList)
	if err != nil {
		return nil, err
	}

	_, err = s.todoListRepository.Update(validatedToDoList)
	if err != nil {
		return nil, err
	}

	result := command.UpdateToDoListCommandResult{
		Result: mapper.NewToDoListResultFromValidatedEntity(validatedToDoList),
	}

	return &result, nil
}
func (s *ToDoListService) DeleteToDoList(todoListCommand *command.DeleteToDoListCommand) (*command.DeleteToDoListCommandResult, error) {

	// Check if todo list exists
	existingToDoList, err := s.todoListRepository.FindById(todoListCommand.Id)
	if err != nil {
		return nil, err
	}

	if existingToDoList == nil {
		return nil, errors.New("todo list not found")
	}

	// Delete todo list
	err = s.todoListRepository.Delete(todoListCommand.Id)
	if err != nil {
		return nil, err
	}

	result := command.DeleteToDoListCommandResult{
		Success: true,
	}

	return &result, nil
}
