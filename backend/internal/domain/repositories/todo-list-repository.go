package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

// atSeq on the write methods is the originating event's log position
// (StoredEvent.Seq) - the projection's high-water mark, guarding against
// applying an event older than what a row already reflects. It's a
// parameter, not a field on entities.ToDoList: it belongs to "how far this
// projection has replayed", not to the list itself.
type ToDoListRepository interface {
	Create(ctx context.Context, todoList *entities.ValidatedToDoList, atSeq int64) error
	FindById(ctx context.Context, id uuid.UUID) (*entities.ToDoList, error)
	Update(ctx context.Context, todoList *entities.ValidatedToDoList, atSeq int64) error
	Delete(ctx context.Context, id uuid.UUID, deletedAt time.Time, atSeq int64) error
}
