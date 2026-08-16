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

func (repo *SqlcToDoListRepository) Create(ctx context.Context, toDoList *entities.ValidatedToDoList) error {
	return repo.queries.CreateToDoList(ctx, db.CreateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		CreatedAt: timestamptzFromTime(toDoList.CreatedAt),
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
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

func (repo *SqlcToDoListRepository) Update(ctx context.Context, toDoList *entities.ValidatedToDoList) error {
	return repo.queries.UpdateToDoList(ctx, db.UpdateToDoListParams{
		ID:        toDoList.Id,
		Name:      toDoList.Name,
		UpdatedAt: timestamptzFromTime(toDoList.UpdatedAt),
	})
}

func (repo *SqlcToDoListRepository) Delete(ctx context.Context, id uuid.UUID, deletedAt time.Time) error {
	return repo.queries.DeleteToDoList(ctx, db.DeleteToDoListParams{
		ID:        id,
		CreatedAt: timestamptzFromTime(deletedAt),
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

// txBeginner is what WithinTx needs to start a transaction - satisfied by
// both *pgxpool.Pool (production) and the *pgx.Conn testhelpers.SetupTestDB
// hands out (tests stay on a single serial connection), mirroring the same
// db.DBTX abstraction NewQueries already relies on in connection.go.
type txBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

type SqlcToDoListTx struct {
	conn txBeginner
}

func NewSqlcToDoListTx(conn txBeginner) repositories.ToDoListTx {
	return &SqlcToDoListTx{conn: conn}
}

func (t *SqlcToDoListTx) WithinTx(ctx context.Context, fn func(repo repositories.ToDoListRepository) error) error {
	tx, err := t.conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	repo := NewSqlcToDoListRepository(db.New(tx))
	if err := fn(repo); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
