package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

type SqlcToDoListRepository struct {
	queries *db.Queries
}

func NewSqlcToDoListRepository(queries *db.Queries) repositories.ToDoListRepository {
	return &SqlcToDoListRepository{queries: queries}
}

func (repo *SqlcToDoListRepository) Create(ctx context.Context, toDoList *entities.ValidatedToDoList, atSeq int64) error {
	return repo.queries.CreateToDoList(ctx, db.CreateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		CreatedAt: timestamptzFromTime(toDoList.CreatedAt),
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
		AtSeq:     atSeq,
	})
}

func (repo *SqlcToDoListRepository) FindById(ctx context.Context, id uuid.UUID) (*entities.ToDoList, error) {
	row, err := repo.queries.GetToDoListById(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Not found (or soft-deleted - GetToDoListById filters
			// deleted_at) is a nil result, not an error: callers
			// distinguish "missing" from "query failed" by the nil check.
			return nil, nil
		}
		return nil, err
	}

	return fromSqlcToDoListRow(&row), nil
}

func (repo *SqlcToDoListRepository) Update(ctx context.Context, toDoList *entities.ValidatedToDoList, atSeq int64) error {
	return repo.queries.UpdateToDoList(ctx, db.UpdateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
		AtSeq:     atSeq,
	})
}

func (repo *SqlcToDoListRepository) Delete(ctx context.Context, id uuid.UUID, deletedAt time.Time, atSeq int64) error {
	return repo.queries.DeleteToDoList(ctx, db.DeleteToDoListParams{
		ID:           id,
		TombstonedAt: timestamptzFromTime(deletedAt),
		AtSeq:        atSeq,
	})
}

func fromSqlcToDoListRow(row *db.GetToDoListByIdRow) *entities.ToDoList {
	toDoList := &entities.ToDoList{
		Id:        row.ID,
		Name:      row.Name,
		CreatedAt: timeFromTimestamptz(row.CreatedAt),
		UpdatedAt: timeFromTimestamptz(row.UpdatedAt),
	}

	return toDoList
}
