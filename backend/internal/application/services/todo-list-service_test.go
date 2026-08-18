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
	repo := postgres.NewSqlcToDoListRepository(postgres.NewQueries(testDB.Conn))
	return NewToDoListService(repo)
}

// rawToDoListRow reads a todo_lists row directly, bypassing the
// deleted_at IS NULL filter every repository read applies - the only way
// these tests can see a tombstoned row's full state (including its
// timestamps) to compare two independent applications of the same events.
func rawToDoListRow(t *testing.T, testDB *testhelpers.PostgresTestContainer, id uuid.UUID) (name string, deleted bool, createdAt, updatedAt time.Time) {
	t.Helper()
	err := testDB.Conn.QueryRow(context.Background(),
		"SELECT name, deleted_at IS NOT NULL, created_at, updated_at FROM todo_lists WHERE id = $1", id,
	).Scan(&name, &deleted, &createdAt, &updatedAt)
	require.NoError(t, err)
	return name, deleted, createdAt, updatedAt
}

// TestToDoListService_ForwardApplication_IsDeterministic is invariant 6.1
// from sync-sharing-target.md: applying the same event sequence must always
// produce the same projection state, timestamps included - so a from-scratch
// replay (e.g. a future rebuild) can never diverge from what forward
// application already produced. The row is dropped and the same three
// service calls are replayed against a clean slate; a test that only ran
// the calls once and re-read the same row could not catch a determinism
// break (see sync-sharing-target.md 6.1's "kein Test - er kann nicht
// fehlschlagen").
func TestToDoListService_ForwardApplication_IsDeterministic_CreatedUpdatedDeleted(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	ctx := context.Background()

	listID := uuid.New()
	t1 := time.Now().UTC().Add(-3 * time.Hour)
	t2 := t1.Add(time.Hour)
	t3 := t2.Add(time.Hour)

	apply := func() {
		_, err := service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "Rewe", OccurredAt: t1})
		require.NoError(t, err)
		_, err = service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{Id: listID, Name: "Aldi", OccurredAt: t2})
		require.NoError(t, err)
		_, err = service.DeleteToDoList(ctx, &command.DeleteToDoListCommand{Id: listID, OccurredAt: t3})
		require.NoError(t, err)
	}

	apply()
	firstName, firstDeleted, firstCreatedAt, firstUpdatedAt := rawToDoListRow(t, testDB, listID)
	require.True(t, firstDeleted)

	// Reset to a clean slate and replay - a from-scratch rebuild's starting
	// point.
	_, err := testDB.Conn.Exec(ctx, "DELETE FROM todo_lists WHERE id = $1", listID)
	require.NoError(t, err)

	apply()
	secondName, secondDeleted, secondCreatedAt, secondUpdatedAt := rawToDoListRow(t, testDB, listID)

	assert.Equal(t, firstName, secondName)
	assert.Equal(t, firstDeleted, secondDeleted)
	assert.True(t, firstCreatedAt.Equal(secondCreatedAt))
	assert.True(t, firstUpdatedAt.Equal(secondUpdatedAt))
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

	// Wait on isProcessed, not on the ack: since seq is assigned at insert,
	// process() acks before apply() dispatches and marks the event - the ack
	// no longer implies the projection ran.
	require.Eventually(t, func() bool { return eventRepo.isProcessed(event.EventID) }, time.Second, time.Millisecond)
	assert.True(t, ack.has(event.EventID))
}

// TestToDoListService_CreateAndUpdate_EmptyNameIsAPermanentError asserts
// that the one error CreateToDoList/UpdateToDoList can return today - a
// validation failure from entities.NewValidatedToDoList - is wrapped in
// interfaces.ErrPermanent, since retrying an empty-name event can never
// succeed. A repository-layer error is deliberately not covered here: it's
// left unwrapped because it may well be transient (e.g. a DB blip).
func TestToDoListService_CreateAndUpdate_EmptyNameIsAPermanentError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	service := newTestToDoListService(testDB)
	ctx := context.Background()
	listID := uuid.New()
	now := time.Now().UTC()

	_, err := service.CreateToDoList(ctx, &command.CreateToDoListCommand{Id: listID, Name: "", OccurredAt: now})
	require.Error(t, err)
	assert.ErrorIs(t, err, interfaces.ErrPermanent)

	_, err = service.UpdateToDoList(ctx, &command.UpdateToDoListCommand{Id: listID, Name: "", OccurredAt: now})
	require.Error(t, err)
	assert.ErrorIs(t, err, interfaces.ErrPermanent)
}

// TestEventIngestor_ToDoListCreated_EmptyName_IsMarkedProcessedAndAcked is
// the end-to-end regression test for a permanently undeliverable event
// reaching the real service/handler stack (not the fakeHandler used
// elsewhere): a todo_list.created with an empty name must not poison the
// queue the same way an unknown list id used to before this fix - it's
// recorded and acked, not retried forever.
func TestEventIngestor_ToDoListCreated_EmptyName_IsMarkedProcessedAndAcked(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	service := newTestToDoListService(testDB)
	repo := postgres.NewSqlcToDoListRepository(postgres.NewQueries(testDB.Conn))
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
	payload, err := json.Marshal(events.CreateToDoListEvent{Name: ""})
	require.NoError(t, err)
	event := &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     events.EventTypeCreateToDoList,
		AggregateID:   listID,
		AggregateType: "todo_list",
		ListID:        &listID,
		Payload:       payload,
		OccurredAt:    time.Now().UTC(),
		ClientID:      "client-1",
	}

	require.NoError(t, ingestor.Enqueue(ctx, event))

	// Wait on isProcessed, not on the ack: since seq is assigned at insert,
	// process() acks before apply() dispatches and marks the event - the ack
	// no longer implies the projection ran.
	require.Eventually(t, func() bool { return eventRepo.isProcessed(event.EventID) }, time.Second, time.Millisecond)
	assert.True(t, ack.has(event.EventID))

	// The permanent error means the list was never actually created either -
	// only the event's fate (processed, acked) changed, not CreateToDoList's
	// own no-op-on-failure behavior.
	found, err := repo.FindById(ctx, listID)
	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestEventIngestor_ToDoListCreated_MalformedPayload_IsMarkedProcessedAndAcked
// is the same regression, triggered by the other permanent-error source:
// json.Unmarshal failing on a payload that isn't valid JSON for the event
// type at all (as opposed to valid JSON with an invalid field value).
func TestEventIngestor_ToDoListCreated_MalformedPayload_IsMarkedProcessedAndAcked(t *testing.T) {
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
	event := &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     events.EventTypeCreateToDoList,
		AggregateID:   listID,
		AggregateType: "todo_list",
		ListID:        &listID,
		Payload:       json.RawMessage(`{"name": `), // truncated - not valid JSON
		OccurredAt:    time.Now().UTC(),
		ClientID:      "client-1",
	}

	require.NoError(t, ingestor.Enqueue(ctx, event))

	// Wait on isProcessed, not on the ack: since seq is assigned at insert,
	// process() acks before apply() dispatches and marks the event - the ack
	// no longer implies the projection ran.
	require.Eventually(t, func() bool { return eventRepo.isProcessed(event.EventID) }, time.Second, time.Millisecond)
	assert.True(t, ack.has(event.EventID))
}
