package postgres

import (
	"testing"

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

	found, err := repo.FindById(uuid.New())

	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestSqlcToDoListRepository_FindById_ExistingListRoundtrips(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))

	toDoList := entities.NewToDoList(uuid.New(), "Rewe")
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	_, err = repo.Create(validated)
	require.NoError(t, err)

	found, err := repo.FindById(toDoList.Id)

	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, toDoList.Id, found.Id)
	assert.Equal(t, "Rewe", found.Name)
}

func TestSqlcToDoListRepository_FindById_SoftDeletedListReturnsNilWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))

	toDoList := entities.NewToDoList(uuid.New(), "Rewe")
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	_, err = repo.Create(validated)
	require.NoError(t, err)
	require.NoError(t, repo.Delete(toDoList.Id))

	found, err := repo.FindById(toDoList.Id)

	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Update_OfAnUnknownListDoesNotPanic guards the
// call chain Update -> FindById (see sqlc_todo-list-repository.go) now that
// FindById can return (nil, nil): Update itself doesn't check for a missing
// row (UpdateToDoList's UPDATE matches zero rows silently), so it must not
// panic dereferencing a nil result.
func TestSqlcToDoListRepository_Update_OfAnUnknownListDoesNotPanic(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))

	toDoList := entities.NewToDoList(uuid.New(), "Rewe")
	require.NoError(t, toDoList.UpdateName("Aldi"))
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)

	found, err := repo.Update(validated)

	require.NoError(t, err)
	assert.Nil(t, found)
}
