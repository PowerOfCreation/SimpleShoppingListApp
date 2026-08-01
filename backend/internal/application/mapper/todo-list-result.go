package mapper

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

func NewToDoListResultFromValidatedEntity(todoList *entities.ValidatedToDoList) *common.ToDoListResult {
	return NewToDoListResultFromEntity(&todoList.ToDoList)
}

func NewToDoListResultFromEntity(todoList *entities.ToDoList) *common.ToDoListResult {
	if todoList == nil {
		return nil
	}

	return &common.ToDoListResult{
		Id:        todoList.Id,
		Name:      todoList.Name,
		CreatedAt: todoList.CreatedAt,
		UpdatedAt: todoList.UpdatedAt,
	}
}
