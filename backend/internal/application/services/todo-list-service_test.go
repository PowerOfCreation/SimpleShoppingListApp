package services

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/events"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func newTestToDoListService(testDB *testhelpers.PostgresTestContainer) interfaces.ToDoListService {
	queries := postgres.NewQueries(testDB.Conn)
	repo := postgres.NewSqlcToDoListRepository(queries)
	tx := postgres.NewSqlcToDoListTx(testDB.Conn)
	eventRepo := postgres.NewSqlcEventRepository(queries)
	return NewToDoListService(testLogger(), repo, tx, eventRepo)
}

// rawToDoListRow reads a todo_lists row directly, bypassing the
// deleted_at IS NULL filter every repository read applies - the only way
// these tests can see a tombstoned row's name/deleted-ness to compare
// forward application against RebuildList.
func rawToDoListRow(t *testing.T, testDB *testhelpers.PostgresTestContainer, id uuid.UUID) (name string, deleted bool) {
	t.Helper()
	err := testDB.Conn.QueryRow(context.Background(),
		"SELECT name, deleted_at IS NOT NULL FROM todo_lists WHERE id = $1", id,
	).Scan(&name, &deleted)
	require.NoError(t, err)
	return name, deleted
}

// insertProcessedEvent durably stores an event the way EventIngestor would
// once it's finished processing it - present in the event log with a seq,
// so RebuildList's FindEventsSince can see it.
func insertProcessedEvent(t *testing.T, eventRepo repositories.EventRepository, listID uuid.UUID, eventType string, payload any, occurredAt time.Time) {
	t.Helper()
	raw, err := json.Marshal(payload)
	require.NoError(t, err)

	ctx := context.Background()
	stored := &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     eventType,
		AggregateID:   listID,
		AggregateType: "todo_list",
		ListID:        &listID,
		Payload:       raw,
		OccurredAt:    occurredAt,
		ClientID:      "client-1",
	}

	_, _, _, err = eventRepo.Insert(ctx, stored)
	require.NoError(t, err)
	_, _, err = eventRepo.MarkProcessed(ctx, stored.EventID)
	require.NoError(t, err)
}

// TestToDoListService_RebuildList_MatchesForwardApplication is the plan's
// leading invariant: forward application and RebuildList must produce the
// same end state for the same event sequence. Both are run against the
// same row (RebuildList replays and overwrites it), so a mismatch would
// show up as a changed name or deleted-ness after the rebuild.
func TestToDoListService_RebuildList_MatchesForwardApplication_CreatedUpdatedDeleted(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	eventRepo := postgres.NewSqlcEventRepository(postgres.NewQueries(testDB.Conn))
	ctx := context.Background()

	listID := uuid.New()
	t1 := time.Now().UTC().Add(-3 * time.Hour)
	t2 := t1.Add(time.Hour)
	t3 := t2.Add(time.Hour)

	insertProcessedEvent(t, eventRepo, listID, events.EventTypeCreateToDoList, events.CreateToDoListEvent{Name: "Rewe"}, t1)
	insertProcessedEvent(t, eventRepo, listID, events.EventTypeUpdateToDoList, events.UpdateToDoListEvent{Name: "Aldi"}, t2)
	insertProcessedEvent(t, eventRepo, listID, events.EventTypeDeleteToDoList, events.DeleteToDoListEvent{}, t3)

	// Forward application: dispatch the same three commands EventIngestor
	// would have, in the same order.
	_, err := service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "Rewe", OccurredAt: t1})
	require.NoError(t, err)
	_, err = service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{Id: listID, Name: "Aldi", OccurredAt: t2})
	require.NoError(t, err)
	_, err = service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: t3})
	require.NoError(t, err)

	forwardName, forwardDeleted := rawToDoListRow(t, testDB, listID)
	require.True(t, forwardDeleted)

	require.NoError(t, service.RebuildList(ctx, listID))

	rebuiltName, rebuiltDeleted := rawToDoListRow(t, testDB, listID)
	assert.Equal(t, forwardName, rebuiltName)
	assert.Equal(t, forwardDeleted, rebuiltDeleted)
}

// TestToDoListService_CreateToDoList_AfterDeleteDoesNotResurrectTheList
// covers a re-delivered created arriving after its list was already
// deleted - possible because the unprocessed-event sweep can replay a
// previously-failed create after a later delete has already landed.
// deleted_at is terminal: the list must stay gone.
func TestToDoListService_CreateToDoList_AfterDeleteDoesNotResurrectTheList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	repo := postgres.NewSqlcToDoListRepository(postgres.NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	now := time.Now().UTC()

	_, err := service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "Rewe", OccurredAt: now})
	require.NoError(t, err)
	_, err = service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: now.Add(time.Minute)})
	require.NoError(t, err)

	_, err = service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "Rewe", OccurredAt: now})
	require.NoError(t, err)

	found, err := repo.FindById(ctx, listID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestToDoListService_UpdateToDoList_ForUnknownListIsNotAnError asserts
// todo_lists's "row missing is never an error" contract: an update for a
// list id this server has never seen must not error, and must not
// materialize a row either.
func TestToDoListService_UpdateToDoList_ForUnknownListIsNotAnError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	repo := postgres.NewSqlcToDoListRepository(postgres.NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()

	_, err := service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{Id: listID, Name: "Aldi", OccurredAt: time.Now().UTC()})
	require.NoError(t, err)

	found, err := repo.FindById(ctx, listID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestToDoListService_UpdateToDoList_ForDeletedListIsNotAnError asserts the
// same no-error contract for a list that did exist but is now tombstoned -
// deleted_at is terminal, so the update must be a no-op, not an error.
func TestToDoListService_UpdateToDoList_ForDeletedListIsNotAnError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	repo := postgres.NewSqlcToDoListRepository(postgres.NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	now := time.Now().UTC()

	_, err := service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "Rewe", OccurredAt: now})
	require.NoError(t, err)
	_, err = service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: now.Add(time.Minute)})
	require.NoError(t, err)

	_, err = service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{Id: listID, Name: "Aldi", OccurredAt: now.Add(2 * time.Minute)})
	require.NoError(t, err)

	found, err := repo.FindById(ctx, listID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestToDoListService_DeleteToDoList_ForUnknownListIsIdempotent asserts the
// tombstone-upsert: deleting a list this server has never created still
// succeeds, and a second delete of the same id changes nothing further.
func TestToDoListService_DeleteToDoList_ForUnknownListIsIdempotent(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	ctx := context.Background()
	listID := uuid.New()
	now := time.Now().UTC()

	_, err := service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: now})
	require.NoError(t, err)
	_, err = service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: now})
	require.NoError(t, err)
}

// TestEventIngestor_ToDoListUpdated_ForUnknownList_IsMarkedProcessedAndAcked
// is the regression test for the bug this change fixes: before, an
// UpdateToDoList for a list this server had never seen returned
// errors.New("todo list not found"), which EventIngestor.dispatchAndAck
// treats as a dispatch failure - skipping both MarkProcessed and the ack.
// That poisoned the queue forever: sweepUnprocessed would keep retrying it
// on every restart, and the client, never acked, would keep resending it.
// Real handlers and a real todo_lists table (via testcontainers) are used
// here, not the fakeHandler elsewhere in this package - the bug lived in
// ToDoListService, not in EventIngestor's own orchestration.
func TestEventIngestor_ToDoListUpdated_ForUnknownList_IsMarkedProcessedAndAcked(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	service := newTestToDoListService(testDB)
	dispatcher := NewEventDispatcher(testLogger(),
		NewCreateToDoListEventHandler(service),
		NewUpdateToDoListEventHandler(service),
		NewDeleteToDoListEventHandler(service),
	)
	eventRepo := newFakeEventRepo()
	ack := &fakeAckPublisher{}
	ingestor := NewEventIngestor(testLogger(), eventRepo, dispatcher, ack)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ingestor.Start(ctx)
	defer ingestor.Stop()

	listID := uuid.New()
	payload, err := json.Marshal(events.UpdateToDoListEvent{Name: "Aldi"})
	require.NoError(t, err)
	event := &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     events.EventTypeUpdateToDoList,
		AggregateID:   listID,
		AggregateType: "todo_list",
		ListID:        &listID,
		Payload:       payload,
		OccurredAt:    time.Now().UTC(),
		ClientID:      "client-1",
	}

	require.NoError(t, ingestor.Enqueue(ctx, event))

	require.Eventually(t, func() bool { return ack.has(event.EventID) }, time.Second, time.Millisecond)
	assert.True(t, eventRepo.isProcessed(event.EventID))
}
