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

// ToDoListTx runs a function against a ToDoListRepository bound to a single
// transaction, so multi-step writes (e.g. RebuildList replaying a whole
// event history) either all land or none do.
type ToDoListTx interface {
	WithinTx(ctx context.Context, fn func(repo ToDoListRepository) error) error
}
