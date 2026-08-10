package postgres

import (
	"context"
	"errors"

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

func (repo *SqlcToDoListRepository) Create(toDoList *entities.ValidatedToDoList) (*entities.ToDoList, error) {
	ctx := context.Background()

	createdToDoList, err := repo.queries.CreateToDoList(ctx, db.CreateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		CreatedAt: timestamptzFromTime(toDoList.CreatedAt),
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
	})

	if err != nil {
		return nil, err
	}

	return repo.FindById(createdToDoList.ID)
}

func (repo *SqlcToDoListRepository) FindById(id uuid.UUID) (*entities.ToDoList, error) {
	ctx := context.Background()

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

func (repo *SqlcToDoListRepository) FindAll() ([]*entities.ToDoList, error) {
	ctx := context.Background()

	rows, err := repo.queries.GetAllToDoLists(ctx)
	if err != nil {
		return nil, err
	}

	toDoLists := make([]*entities.ToDoList, len(rows))
	for i, row := range rows {
		toDoLists[i] = fromSqlcToDoListRowAll(&row)
	}

	return toDoLists, nil
}

func (repo *SqlcToDoListRepository) Update(toDoList *entities.ValidatedToDoList) (*entities.ToDoList, error) {
	ctx := context.Background()

	err := repo.queries.UpdateToDoList(ctx, db.UpdateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
	})
	if err != nil {
		return nil, err
	}

	return repo.FindById(toDoList.Id)
}

func (repo *SqlcToDoListRepository) Delete(id uuid.UUID) error {
	ctx := context.Background()
	return repo.queries.DeleteToDoList(ctx, id)
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

func fromSqlcToDoListRowAll(row *db.GetAllToDoListsRow) *entities.ToDoList {

	toDoList := &entities.ToDoList{
		Id:        row.ID,
		Name:      row.Name,
		CreatedAt: timeFromTimestamptz(row.CreatedAt),
		UpdatedAt: timeFromTimestamptz(row.UpdatedAt),
	}

	return toDoList
}
