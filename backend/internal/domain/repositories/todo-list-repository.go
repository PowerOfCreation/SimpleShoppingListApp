package repositories

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type ToDoListRepository interface {
	Create(todoList *entities.ValidatedToDoList) (*entities.ToDoList, error)
	FindById(id uuid.UUID) (*entities.ToDoList, error)
	Update(todoList *entities.ValidatedToDoList) (*entities.ToDoList, error)
	Delete(id uuid.UUID) error
}
