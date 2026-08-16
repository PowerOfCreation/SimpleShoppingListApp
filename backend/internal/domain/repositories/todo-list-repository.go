package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

type ToDoListRepository interface {
	Create(ctx context.Context, todoList *entities.ValidatedToDoList) error
	FindById(ctx context.Context, id uuid.UUID) (*entities.ToDoList, error)
	Update(ctx context.Context, todoList *entities.ValidatedToDoList) error
	Delete(ctx context.Context, id uuid.UUID, deletedAt time.Time) error
}
