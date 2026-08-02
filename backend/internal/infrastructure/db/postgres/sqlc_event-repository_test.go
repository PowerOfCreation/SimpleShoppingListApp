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

// makeStoredEventForList is makeStoredEvent with list_id set, for tests
// exercising the list-scoped queries (FindKnownEventIDsByList,
// FindListHeads, FindEventsSince).
func makeStoredEventForList(listID uuid.UUID) *repositories.StoredEvent {
	event := makeStoredEvent()
	event.AggregateID = listID
	event.ListID = &listID
	return event
}

func TestSqlcEventRepository_Insert_FreshEventIsNotAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	alreadyProcessed, _, _, err := repo.Insert(ctx, makeStoredEvent())

	require.NoError(t, err)
	assert.False(t, alreadyProcessed)
}

func TestSqlcEventRepository_Insert_DuplicateBeforeProcessingIsNotAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	// Same event_id delivered again before it was ever marked processed
	// (e.g. two overlapping requests) - Insert must not error, and must
	// still report it as not-yet-processed so the caller knows a dispatch
	// is still owed.
	alreadyProcessed, _, _, err := repo.Insert(ctx, event)

	require.NoError(t, err)
	assert.False(t, alreadyProcessed)
}

func TestSqlcEventRepository_Insert_AfterProcessingIsAlreadyProcessed(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)
	markedSeq, _, err := repo.MarkProcessed(ctx, event.EventID)
	require.NoError(t, err)

	// A resend after the ack was lost - self-heal / reconcile path. It must
	// still report the seq that was already assigned, so the caller can ack
	// with it instead of leaving the client stuck without one.
	alreadyProcessed, seq, _, err := repo.Insert(ctx, event)

	require.NoError(t, err)
	assert.True(t, alreadyProcessed)
	assert.Equal(t, markedSeq, seq)
}

func TestSqlcEventRepository_Insert_DoesNotOverwriteStoredFields(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	// A conflicting re-insert with a (hypothetically) different payload must
	// not clobber the original - the upsert only touches `id`.
	tampered := *event
	tampered.Payload = json.RawMessage(`{"name":"Tampered"}`)
	_, _, _, err = repo.Insert(ctx, &tampered)
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

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	before, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	assert.Len(t, before, 1)

	_, _, err = repo.MarkProcessed(ctx, event.EventID)
	require.NoError(t, err)

	after, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	assert.Empty(t, after)
}

func TestSqlcEventRepository_MarkProcessed_AssignsMonotonicSeq(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	first := makeStoredEvent()
	second := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, first)
	require.NoError(t, err)
	_, _, _, err = repo.Insert(ctx, second)
	require.NoError(t, err)

	firstSeq, firstListID, err := repo.MarkProcessed(ctx, first.EventID)
	require.NoError(t, err)
	secondSeq, _, err := repo.MarkProcessed(ctx, second.EventID)
	require.NoError(t, err)

	assert.Greater(t, firstSeq, int64(0))
	assert.Greater(t, secondSeq, firstSeq)
	assert.Nil(t, firstListID, "makeStoredEvent leaves list_id unset")
}

func TestSqlcEventRepository_MarkProcessed_ReturnsTheEventsListID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEventForList(listID)

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	_, gotListID, err := repo.MarkProcessed(ctx, event.EventID)

	require.NoError(t, err)
	require.NotNil(t, gotListID)
	assert.Equal(t, listID, *gotListID)
}

func TestSqlcEventRepository_MarkProcessed_ErrorsOnASecondCallForTheSameEvent(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)
	_, _, err = repo.MarkProcessed(ctx, event.EventID)
	require.NoError(t, err)

	// The seq IS NULL guard means re-marking an already-processed event
	// matches zero rows - given the ingestor's single-writer guarantee,
	// this can only happen from a bug, so it must surface as an error
	// rather than silently reassigning a second seq.
	_, _, err = repo.MarkProcessed(ctx, event.EventID)

	assert.Error(t, err)
}

func TestSqlcEventRepository_FindUnprocessed_RoundTripsFields(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	event := makeStoredEvent()

	_, _, _, err := repo.Insert(ctx, event)
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

func TestSqlcEventRepository_FindKnownEventIDsByList_OnlyReturnsProcessedEventsForRequestedLists(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	requestedList := uuid.New()
	otherList := uuid.New()
	processedForRequested := makeStoredEventForList(requestedList)
	unprocessedForRequested := makeStoredEventForList(requestedList)
	processedForOther := makeStoredEventForList(otherList)

	for _, e := range []*repositories.StoredEvent{processedForRequested, unprocessedForRequested, processedForOther} {
		_, _, _, err := repo.Insert(ctx, e)
		require.NoError(t, err)
	}
	_, _, err := repo.MarkProcessed(ctx, processedForRequested.EventID)
	require.NoError(t, err)
	_, _, err = repo.MarkProcessed(ctx, processedForOther.EventID)
	require.NoError(t, err)

	known, err := repo.FindKnownEventIDsByList(ctx, []uuid.UUID{requestedList})

	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{processedForRequested.EventID}, known)
}

func TestSqlcEventRepository_FindKnownEventIDsByList_EmptyForUnknownList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	known, err := repo.FindKnownEventIDsByList(ctx, []uuid.UUID{uuid.New()})

	require.NoError(t, err)
	assert.Empty(t, known)
}

func TestSqlcEventRepository_FindListHeads_ReturnsMaxSeqPerList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	older := makeStoredEventForList(listID)
	newer := makeStoredEventForList(listID)

	_, _, _, err := repo.Insert(ctx, older)
	require.NoError(t, err)
	_, _, _, err = repo.Insert(ctx, newer)
	require.NoError(t, err)
	_, _, err = repo.MarkProcessed(ctx, older.EventID)
	require.NoError(t, err)
	newerSeq, _, err := repo.MarkProcessed(ctx, newer.EventID)
	require.NoError(t, err)

	heads, err := repo.FindListHeads(ctx, []uuid.UUID{listID})

	require.NoError(t, err)
	require.Len(t, heads, 1)
	assert.Equal(t, listID, heads[0].ListID)
	assert.Equal(t, newerSeq, heads[0].Seq)
	assert.Equal(t, newer.EventID, heads[0].EventID)
}

func TestSqlcEventRepository_FindListHeads_OmitsListsWithNoProcessedEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	unprocessed := makeStoredEventForList(listID)
	_, _, _, err := repo.Insert(ctx, unprocessed)
	require.NoError(t, err)

	heads, err := repo.FindListHeads(ctx, []uuid.UUID{listID, uuid.New()})

	require.NoError(t, err)
	assert.Empty(t, heads)
}

func TestSqlcEventRepository_FindEventsSince_OrdersBySeqAndRespectsSinceSeqAndLimit(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	e1 := makeStoredEventForList(listID)
	e2 := makeStoredEventForList(listID)
	e3 := makeStoredEventForList(listID)

	for _, e := range []*repositories.StoredEvent{e1, e2, e3} {
		_, _, _, err := repo.Insert(ctx, e)
		require.NoError(t, err)
	}
	seq1, _, err := repo.MarkProcessed(ctx, e1.EventID)
	require.NoError(t, err)
	_, _, err = repo.MarkProcessed(ctx, e2.EventID)
	require.NoError(t, err)
	seq3, _, err := repo.MarkProcessed(ctx, e3.EventID)
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, seq1, 1)

	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.Equal(t, e2.EventID, page[0].EventID)
	assert.NotEqual(t, seq3, page[0].Seq)
}

func TestSqlcEventRepository_FindEventsSince_EmptyWhenAlreadyCaughtUp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEventForList(listID)
	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)
	seq, _, err := repo.MarkProcessed(ctx, event.EventID)
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, seq, 50)

	require.NoError(t, err)
	assert.Empty(t, page)
}

func TestSqlcEventRepository_FindEventsSince_RoundTripsSeqAndListID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEventForList(listID)
	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)
	seq, _, err := repo.MarkProcessed(ctx, event.EventID)
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, 0, 50)

	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.Equal(t, seq, page[0].Seq)
	require.NotNil(t, page[0].ListID)
	assert.Equal(t, listID, *page[0].ListID)
}

func TestSqlcEventRepository_Insert_RoundTripsListID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcEventRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	event := makeStoredEvent()
	listID := uuid.New()
	event.ListID = &listID

	_, _, _, err := repo.Insert(ctx, event)
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

	_, _, _, err := repo.Insert(ctx, event)
	require.NoError(t, err)

	unprocessed, err := repo.FindUnprocessed(ctx)
	require.NoError(t, err)
	require.Len(t, unprocessed, 1)
	assert.Nil(t, unprocessed[0].ListID)
}
