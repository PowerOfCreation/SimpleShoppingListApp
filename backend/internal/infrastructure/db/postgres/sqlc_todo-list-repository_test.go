package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestSqlcToDoListRepository_FindById_UnknownIdReturnsNilWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))

	found, err := repo.FindById(context.Background(), uuid.New())

	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestSqlcToDoListRepository_FindById_ExistingListRoundtrips(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated))

	found, err := repo.FindById(ctx, toDoList.Id)

	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, toDoList.Id, found.Id)
	assert.Equal(t, "Rewe", found.Name)
}

func TestSqlcToDoListRepository_FindById_SoftDeletedListReturnsNilWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC()))

	found, err := repo.FindById(ctx, toDoList.Id)

	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Update_OfAnUnknownListIsANoOp guards the "row
// missing is never an error" contract: todo_lists is a derived projection,
// not the authority, so UPDATE matching zero rows must not surface as an
// error, and must not conjure a row into existence either.
func TestSqlcToDoListRepository_Update_OfAnUnknownListIsANoOp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Aldi", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)

	require.NoError(t, repo.Update(ctx, validated))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Update_OfASoftDeletedListIsANoOp asserts the
// deleted_at guard on UPDATE: a tombstoned row must stay tombstoned and
// unmodified, not be revived or renamed by a late-arriving update.
func TestSqlcToDoListRepository_Update_OfASoftDeletedListIsANoOp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC()))

	renamed := entities.NewToDoListAt(toDoList.Id, "Aldi", time.Now().UTC())
	validated, err = entities.NewValidatedToDoList(renamed)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validated))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Delete_OfAnUnknownListIsIdempotent asserts the
// tombstone-upsert: deleting a list this server has never created still
// succeeds (planting the tombstone itself) rather than erroring, and a
// second delete of the same id changes nothing further.
func TestSqlcToDoListRepository_Delete_OfAnUnknownListIsIdempotent(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	id := uuid.New()

	require.NoError(t, repo.Delete(ctx, id, time.Now().UTC()))
	require.NoError(t, repo.Delete(ctx, id, time.Now().UTC()))

	found, err := repo.FindById(ctx, id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Create_AfterDeleteDoesNotResurrect is the
// projection's terminal-tombstone guarantee: a re-delivered created for a
// list already tombstoned (e.g. the unprocessed-event sweep replaying a
// create that originally failed after a delete had already landed) must
// not bring the list back.
func TestSqlcToDoListRepository_Create_AfterDeleteDoesNotResurrect(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC()))

	require.NoError(t, repo.Create(ctx, validated))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}
