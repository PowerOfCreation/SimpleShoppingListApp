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
	require.NoError(t, repo.Create(ctx, validated, 1))

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
	require.NoError(t, repo.Create(ctx, validated, 1))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC(), 2))

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

	require.NoError(t, repo.Update(ctx, validated, 1))

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
	require.NoError(t, repo.Create(ctx, validated, 1))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC(), 2))

	renamed := entities.NewToDoListAt(toDoList.Id, "Aldi", time.Now().UTC())
	validated, err = entities.NewValidatedToDoList(renamed)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validated, 3))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Update_WithOlderSeqThanAlreadyAppliedIsANoOp is
// the 6.1 forward-application gap this repository now closes structurally:
// a stale update (lower seq) that reaches the projection after a newer one
// already landed - e.g. the sweep retrying an event that failed transiently
// - must not roll the row back.
func TestSqlcToDoListRepository_Update_WithOlderSeqThanAlreadyAppliedIsANoOp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated, 1))

	newer := entities.NewToDoListAt(toDoList.Id, "Aldi", time.Now().UTC())
	validatedNewer, err := entities.NewValidatedToDoList(newer)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validatedNewer, 5))

	stale := entities.NewToDoListAt(toDoList.Id, "Lidl", time.Now().UTC())
	validatedStale, err := entities.NewValidatedToDoList(stale)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validatedStale, 3))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "Aldi", found.Name)
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

	require.NoError(t, repo.Delete(ctx, id, time.Now().UTC(), 1))
	require.NoError(t, repo.Delete(ctx, id, time.Now().UTC(), 2))

	found, err := repo.FindById(ctx, id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Create_AfterDeleteDoesNotResurrect is the
// projection's terminal-tombstone guarantee: a re-delivered created for a
// list already tombstoned (e.g. the unprocessed-event sweep replaying a
// create that originally failed after a delete had already landed) must
// not bring the list back - even carrying a seq newer than the tombstone's,
// since deleted_at is terminal regardless of seq (invariant 6.2).
func TestSqlcToDoListRepository_Create_AfterDeleteDoesNotResurrect(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated, 1))
	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC(), 2))

	require.NoError(t, repo.Create(ctx, validated, 3))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcToDoListRepository_Create_WithOlderSeqThanAlreadyAppliedIsANoOp
// mirrors the Update test above for the create path: a create the sweep
// retried after a later update already landed must not clobber that newer
// content.
func TestSqlcToDoListRepository_Create_WithOlderSeqThanAlreadyAppliedIsANoOp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated, 5))

	newer := entities.NewToDoListAt(toDoList.Id, "Aldi", time.Now().UTC())
	validatedNewer, err := entities.NewValidatedToDoList(newer)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validatedNewer, 7))

	// A retried create, e.g. from a sweep, arrives with the original
	// (older) seq after the update above already applied.
	require.NoError(t, repo.Create(ctx, validated, 5))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "Aldi", found.Name)
}

// TestSqlcToDoListRepository_Delete_WithOlderSeqThanAnAlreadyAppliedUpdateStillTombstones
// documents a deliberate asymmetry with Create/Update's monotonicity guard
// above: Delete has no last_applied_seq guard, and must still tombstone
// even when its own seq is *lower* than what's already landed - e.g. a
// delete durably received early but stuck on a transient failure until a
// sweep retries it, after an update with a higher seq already applied
// live. A full in-order rebuild of [create, delete, update] would apply
// the delete before the update and reject the update via its own
// deleted_at IS NULL guard (see 6.1/6.2 in sync-sharing-target.md, and the
// fuller rationale on DeleteToDoList in sql/queries/todo-lists.sql) -
// guarding this delete on last_applied_seq would make this projection
// diverge from that outcome instead of converging to it.
func TestSqlcToDoListRepository_Delete_WithOlderSeqThanAnAlreadyAppliedUpdateStillTombstones(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcToDoListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	toDoList := entities.NewToDoListAt(uuid.New(), "Rewe", time.Now().UTC())
	validated, err := entities.NewValidatedToDoList(toDoList)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, validated, 1))

	updated := entities.NewToDoListAt(toDoList.Id, "Aldi", time.Now().UTC())
	validatedUpdated, err := entities.NewValidatedToDoList(updated)
	require.NoError(t, err)
	require.NoError(t, repo.Update(ctx, validatedUpdated, 10))

	require.NoError(t, repo.Delete(ctx, toDoList.Id, time.Now().UTC(), 3))

	found, err := repo.FindById(ctx, toDoList.Id)
	require.NoError(t, err)
	assert.Nil(t, found)
}
