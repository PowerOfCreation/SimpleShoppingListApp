package postgres

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func newEventRepo(conn *pgx.Conn) repositories.EventRepository {
	return NewSqlcEventRepository(conn, NewQueries(conn))
}

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

func TestSqlcEventRepository_AppendToList_AssignsSequentialSeqStartingAtOne(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	e1, e2 := makeStoredEvent(), makeStoredEvent()

	headSeq, appended, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{e1, e2}, time.Now())

	require.NoError(t, err)
	assert.True(t, appended)
	assert.Equal(t, int64(1), e1.Seq)
	assert.Equal(t, int64(2), e2.Seq)
	assert.Equal(t, int64(2), headSeq)
}

func TestSqlcEventRepository_AppendToList_SecondCallContinuesFromThePreviousHeadSeq(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	first := makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{first}, time.Now())
	require.NoError(t, err)

	second := makeStoredEvent()
	headSeq, appended, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{second}, time.Now())

	require.NoError(t, err)
	assert.True(t, appended)
	assert.Equal(t, int64(2), second.Seq)
	assert.Equal(t, int64(2), headSeq)
}

// TestSqlcEventRepository_AppendToList_DuplicateEventKeepsOriginalSeq is the
// idempotent-redelivery case: the same event_id pushed twice (e.g. a client
// retry after a lost response) must not be assigned a second, later seq -
// that would let the same logical event appear to move position in the log
// on a resend.
func TestSqlcEventRepository_AppendToList_DuplicateEventKeepsOriginalSeq(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)
	firstSeq := event.Seq

	redelivered := *event
	headSeq, appended, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{&redelivered}, time.Now())

	require.NoError(t, err)
	assert.False(t, appended, "a pure duplicate delivery must not report anything newly appended")
	assert.Equal(t, firstSeq, redelivered.Seq)
	assert.Equal(t, firstSeq, headSeq, "head_seq must not advance for a batch that added nothing new")
}

// TestSqlcEventRepository_AppendToList_MixedBatchOnlyConsumesSeqForNewEvents
// proves a duplicate in the middle of an otherwise-new batch doesn't burn a
// seq slot it didn't use - the events after it must still be contiguous.
func TestSqlcEventRepository_AppendToList_MixedBatchOnlyConsumesSeqForNewEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	alreadyStored := makeStoredEvent()
	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{alreadyStored}, time.Now())
	require.NoError(t, err)

	duplicate := *alreadyStored
	fresh := makeStoredEvent()
	headSeq, appended, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{&duplicate, fresh}, time.Now())

	require.NoError(t, err)
	assert.True(t, appended)
	assert.Equal(t, alreadyStored.Seq, duplicate.Seq)
	assert.Equal(t, int64(2), fresh.Seq, "the duplicate ahead of it must not have consumed a seq")
	assert.Equal(t, int64(2), headSeq)
}

func TestSqlcEventRepository_AppendToList_DifferentListsGetIndependentSeqCounters(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listA, listB := uuid.New(), uuid.New()
	eventA, eventB := makeStoredEvent(), makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, listA, []*repositories.StoredEvent{eventA}, time.Now())
	require.NoError(t, err)
	_, _, err = repo.AppendToList(ctx, listB, []*repositories.StoredEvent{eventB}, time.Now())
	require.NoError(t, err)

	assert.Equal(t, int64(1), eventA.Seq)
	assert.Equal(t, int64(1), eventB.Seq, "listB's counter must not have been advanced by listA's append")
}

func TestSqlcEventRepository_AppendToList_DoesNotOverwriteStoredFieldsOnDuplicate(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()
	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)

	tampered := *event
	tampered.Payload = json.RawMessage(`{"name":"Tampered"}`)
	_, _, err = repo.AppendToList(ctx, listID, []*repositories.StoredEvent{&tampered}, time.Now())
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, 0, 50)
	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.JSONEq(t, `{"name":"Rewe"}`, string(page[0].Payload))
}

func TestSqlcEventRepository_AppendToList_RoundTripsUserID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()
	event.UserID = "alice"

	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, 0, 50)
	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.Equal(t, event.EventID, page[0].EventID)
}

// TestSqlcEventRepository_AppendToList_ConcurrentAppendsForSameListProduceGapfreeUniqueSeq
// is the test the old global-sequence design couldn't support: its
// correctness depended on exactly one EventIngestor goroutine ever calling
// Insert. AppendToList's per-list row lock (LockOrCreateSyncedList) is what
// makes concurrent callers - standing in for concurrent API replicas -
// serialize safely instead of racing for the same seq.
func TestSqlcEventRepository_AppendToList_ConcurrentAppendsForSameListProduceGapfreeUniqueSeq(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	ctx := context.Background()

	// A single *pgx.Conn (testDB.Conn) is documented as unsafe for
	// concurrent use - see NewConnection's own doc comment - so this test
	// needs a real pool, same as TestNewConnection_ConcurrentQueries, to
	// exercise genuinely concurrent transactions rather than just racing on
	// one connection's protocol state.
	dsn := testDB.Container.(interface {
		ConnectionString(ctx context.Context, args ...string) (string, error)
	})
	connString, err := dsn.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	pool, err := NewConnection(ctx, connString)
	require.NoError(t, err)
	defer pool.Close()

	repo := NewSqlcEventRepository(pool, NewQueries(pool))
	listID := uuid.New()

	const concurrency = 20
	var wg sync.WaitGroup
	errs := make([]error, concurrency)
	seqs := make([]int64, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			event := makeStoredEvent()
			_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
			errs[idx] = err
			seqs[idx] = event.Seq
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		require.NoError(t, err, "goroutine %d failed", i)
	}

	seen := make(map[int64]struct{}, concurrency)
	for _, seq := range seqs {
		_, dup := seen[seq]
		assert.False(t, dup, "seq %d was assigned twice", seq)
		seen[seq] = struct{}{}
	}
	for want := int64(1); want <= concurrency; want++ {
		_, ok := seen[want]
		assert.True(t, ok, "seq %d is missing - the run must be gap-free", want)
	}
}

func TestSqlcEventRepository_FindKnownEventIDsByList_ReturnsAllDurablyAppendedEventsForRequestedLists(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()

	requestedList := uuid.New()
	otherList := uuid.New()
	first := makeStoredEvent()
	second := makeStoredEvent()
	forOther := makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, requestedList, []*repositories.StoredEvent{first, second}, time.Now())
	require.NoError(t, err)
	_, _, err = repo.AppendToList(ctx, otherList, []*repositories.StoredEvent{forOther}, time.Now())
	require.NoError(t, err)

	known, err := repo.FindKnownEventIDsByList(ctx, []uuid.UUID{requestedList})

	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{first.EventID, second.EventID}, known)
}

func TestSqlcEventRepository_FindKnownEventIDsByList_EmptyForUnknownList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()

	known, err := repo.FindKnownEventIDsByList(ctx, []uuid.UUID{uuid.New()})

	require.NoError(t, err)
	assert.Empty(t, known)
}

func TestSqlcEventRepository_FindListHeads_ReturnsHeadSeqAndItsEventID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	older, newer := makeStoredEvent(), makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{older, newer}, time.Now())
	require.NoError(t, err)

	heads, err := repo.FindListHeads(ctx, []uuid.UUID{listID})

	require.NoError(t, err)
	require.Len(t, heads, 1)
	assert.Equal(t, listID, heads[0].ListID)
	assert.Equal(t, newer.Seq, heads[0].Seq)
	require.NotNil(t, heads[0].EventID)
	assert.Equal(t, newer.EventID, *heads[0].EventID)
}

// TestSqlcEventRepository_FindListHeads_RegisteredButEmptyListHasNilEventID
// covers a list claimed (its registry row exists, e.g. via
// ListAccessService.AuthorizeWrite's claim) but never actually pushed to -
// head_seq is 0 and there is no event to point at, but the list is not
// "unknown" the way one the registry has no row for at all is.
func TestSqlcEventRepository_FindListHeads_RegisteredButEmptyListHasNilEventID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()

	_, _, err := repo.AppendToList(ctx, listID, nil, time.Now())
	require.NoError(t, err)

	heads, err := repo.FindListHeads(ctx, []uuid.UUID{listID})

	require.NoError(t, err)
	require.Len(t, heads, 1)
	assert.Equal(t, int64(0), heads[0].Seq)
	assert.Nil(t, heads[0].EventID)
}

func TestSqlcEventRepository_FindListHeads_OmitsListsTheRegistryHasNoRowFor(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()
	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)

	heads, err := repo.FindListHeads(ctx, []uuid.UUID{listID, uuid.New()})

	require.NoError(t, err)
	require.Len(t, heads, 1)
	assert.Equal(t, listID, heads[0].ListID)
}

func TestSqlcEventRepository_FindEventsSince_OrdersBySeqAndRespectsSinceSeqAndLimit(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	e1, e2, e3 := makeStoredEvent(), makeStoredEvent(), makeStoredEvent()

	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{e1, e2, e3}, time.Now())
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, e1.Seq, 1)

	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.Equal(t, e2.EventID, page[0].EventID)
	assert.NotEqual(t, e3.Seq, page[0].Seq)
}

func TestSqlcEventRepository_FindEventsSince_EmptyWhenAlreadyCaughtUp(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()
	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, event.Seq, 50)

	require.NoError(t, err)
	assert.Empty(t, page)
}

func TestSqlcEventRepository_FindEventsSince_RoundTripsSeqAndListID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := newEventRepo(testDB.Conn)
	ctx := context.Background()
	listID := uuid.New()
	event := makeStoredEvent()
	_, _, err := repo.AppendToList(ctx, listID, []*repositories.StoredEvent{event}, time.Now())
	require.NoError(t, err)

	page, err := repo.FindEventsSince(ctx, listID, 0, 50)

	require.NoError(t, err)
	require.Len(t, page, 1)
	assert.Equal(t, event.Seq, page[0].Seq)
	require.NotNil(t, page[0].ListID)
	assert.Equal(t, listID, *page[0].ListID)
}
