package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func makeStoredEvent() *repositories.StoredEvent {
	return &repositories.StoredEvent{
		EventID:       uuid.New(),
		EventType:     "todo_list.created",
		AggregateID:   uuid.New(),
		AggregateType: "todo_list",
		Payload:       json.RawMessage(`{"name":"Rewe"}`),
		OccurredAt:    time.Now().UTC().Truncate(time.Millisecond),
		ClientID:      "client-1",
	}
}

func TestSqlcEventRepository_Insert_FreshEventIsNotAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	alreadyProcessed, err := repo.Insert(ctx, makeStoredEvent())

	require.NoError(t, err)
	assert.False(t, alreadyProcessed)
}

func TestSqlcEventRepository_Insert_DuplicateBeforeProcessingIsNotAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	// Same event_id delivered again before it was ever marked processed
	// (e.g. two overlapping requests) - Insert must not error, and must
	// still report it as not-yet-processed so the caller knows a dispatch
	// is still owed.
	alreadyProcessed, err := repo.Insert(ctx, event)

	require.NoError(t, err)
	assert.False(t, alreadyProcessed)
}

func TestSqlcEventRepository_Insert_AfterProcessingIsAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)
	require.NoError(t, repo.MarkProcessed(ctx, event.EventID))

	// A resend after the ack was lost - self-heal / reconcile path.
	alreadyProcessed, err := repo.Insert(ctx, event)

	require.NoError(t, err)
	assert.True(t, alreadyProcessed)
}

func TestSqlcEventRepository_Insert_DoesNotOverwriteStoredFields(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	// A conflicting re-insert with a (hypothetically) different payload must
	// not clobber the original - the upsert only touches `id`.
	tampered := *event
	tampered.Payload = json.RawMessage(`{"name":"Tampered"}`)
	_, err = repo.Insert(ctx, &tampered)
	require.NoError(t, err)

	unprocessed, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	require.Len(t, unprocessed, 1)
	assert.JSONEq(t, `{"name":"Rewe"}`, string(unprocessed[0].Payload))
}

func TestSqlcEventRepository_MarkProcessed_RemovesFromUnprocessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	before, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	assert.Len(t, before, 1)

	require.NoError(t, repo.MarkProcessed(ctx, event.EventID))

	after, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	assert.Empty(t, after)
}

func TestSqlcEventRepository_FindUnprocessed_RoundTripsFields(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	unprocessed, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	require.Len(t, unprocessed, 1)

	got := unprocessed[0]
	assert.Equal(t, event.EventID, got.EventID)
	assert.Equal(t, event.EventType, got.EventType)
	assert.Equal(t, event.AggregateID, got.AggregateID)
	assert.Equal(t, event.AggregateType, got.AggregateType)
	assert.Equal(t, event.ClientID, got.ClientID)
	assert.JSONEq(t, string(event.Payload), string(got.Payload))
	// occurred_at round-trips as UTC, matching how the frontend's epoch-ms
	// value is converted (time.UnixMilli(...).UTC()) before it ever reaches
	// this repository.
	assert.WithinDuration(t, event.OccurredAt, got.OccurredAt.UTC(), 0)
}

func TestSqlcEventRepository_FindKnownEventIDs_OnlyReturnsProcessedEventsForRequestedAggregates(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	processedForRequested := makeStoredEvent()
	unprocessedForRequested := makeStoredEvent()
	unprocessedForRequested.AggregateID = processedForRequested.AggregateID
	processedForOther := makeStoredEvent()

	for _, e := range []*repositories.StoredEvent{processedForRequested, unprocessedForRequested, processedForOther} {
		_, err := repo.Insert(ctx, e)
		require.NoError(t, err)
	}
	require.NoError(t, repo.MarkProcessed(ctx, processedForRequested.EventID))
	require.NoError(t, repo.MarkProcessed(ctx, processedForOther.EventID))

	known, err := repo.FindKnownEventIDs(ctx, []uuid.UUID{processedForRequested.AggregateID})

	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{processedForRequested.EventID}, known)
}

func TestSqlcEventRepository_FindKnownEventIDs_EmptyForUnknownAggregate(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	known, err := repo.FindKnownEventIDs(ctx, []uuid.UUID{uuid.New()})

	require.NoError(t, err)
	assert.Empty(t, known)
}

func TestSqlcEventRepository_Insert_RoundTripsListID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	event := makeStoredEvent()
	listID := uuid.New()
	event.ListID = &listID

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	unprocessed, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	require.Len(t, unprocessed, 1)
	require.NotNil(t, unprocessed[0].ListID)
	assert.Equal(t, listID, *unprocessed[0].ListID)
}

func TestSqlcEventRepository_Insert_NilListIDRoundTripsAsNil(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	// An older client that doesn't send list_id yet.
	event := makeStoredEvent()
	event.ListID = nil

	_, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	unprocessed, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	require.Len(t, unprocessed, 1)
	assert.Nil(t, unprocessed[0].ListID)
}
