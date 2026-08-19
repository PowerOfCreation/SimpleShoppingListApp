package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

// insertPreMigrationEvent inserts a row using the schema as it existed
// through migration 00003 (no list_id, no seq) - the shape any row created
// before migration 00004 would actually have.
func insertPreMigrationEvent(
	t *testing.T,
	testDB *testhelpers.PostgresTestContainer,
	id uuid.UUID,
	eventType string,
	aggregateID uuid.UUID,
	aggregateType string,
	payload string,
	receivedAt time.Time,
	processed bool,
) {
	var processedAt any
	if processed {
		processedAt = receivedAt
	}
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO events (id, event_type, aggregate_id, aggregate_type, payload, occurred_at, received_at, client_id, processed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'client-1', $8)`,
		id, eventType, aggregateID, aggregateType, []byte(payload), receivedAt, receivedAt, processedAt,
	)
	require.NoError(t, err)
}

func TestMigration00004_BackfillsListIDForTodoListEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	eventID := uuid.New()
	listID := uuid.New()
	insertPreMigrationEvent(t, testDB, eventID, "todo_list.created", listID, "todo_list",
		`{"name":"Rewe"}`, time.Now().UTC(), true)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	got := queryListID(t, testDB, eventID)
	require.NotNil(t, got)
	assert.Equal(t, listID, *got)
}

func TestMigration00004_BackfillsListIDFromIngredientCreatedPayload(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	eventID := uuid.New()
	ingredientID := uuid.New()
	listID := uuid.New()
	insertPreMigrationEvent(t, testDB, eventID, "ingredient.created", ingredientID, "ingredient",
		`{"name":"Milk","listId":"`+listID.String()+`"}`, time.Now().UTC(), true)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	got := queryListID(t, testDB, eventID)
	require.NotNil(t, got)
	assert.Equal(t, listID, *got)
}

func TestMigration00004_ResolvesOtherIngredientEventsViaTheirCreatedEvent(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	ingredientID := uuid.New()
	listID := uuid.New()
	createdID := uuid.New()
	updatedID := uuid.New()
	base := time.Now().UTC()

	insertPreMigrationEvent(t, testDB, createdID, "ingredient.created", ingredientID, "ingredient",
		`{"name":"Milk","listId":"`+listID.String()+`"}`, base, true)
	insertPreMigrationEvent(t, testDB, updatedID, "ingredient.updated", ingredientID, "ingredient",
		`{"name":"Whole Milk"}`, base.Add(time.Second), true)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	got := queryListID(t, testDB, updatedID)
	require.NotNil(t, got)
	assert.Equal(t, listID, *got)
}

func TestMigration00004_LeavesListIDNilWhenUnresolvable(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	// No matching ingredient.created event anywhere, and the payload has no
	// listId at all - nothing to backfill from.
	orphanID := uuid.New()
	insertPreMigrationEvent(t, testDB, orphanID, "ingredient.deleted", uuid.New(), "ingredient",
		`{}`, time.Now().UTC(), true)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	got := queryListID(t, testDB, orphanID)
	assert.Nil(t, got)
}

func TestMigration00004_IgnoresMalformedListIdInPayloadWithoutFailing(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	eventID := uuid.New()
	insertPreMigrationEvent(t, testDB, eventID, "ingredient.created", uuid.New(), "ingredient",
		`{"name":"Milk","listId":"not-a-uuid"}`, time.Now().UTC(), true)

	// Must not error - a bad ::uuid cast on this row must not abort the
	// whole migration for every other row.
	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	got := queryListID(t, testDB, eventID)
	assert.Nil(t, got)
}

func TestMigration00004_AssignsMonotonicSeqOnlyToProcessedEventsInReceivedOrder(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	base := time.Now().UTC()
	older := uuid.New()
	newer := uuid.New()
	unprocessed := uuid.New()

	// Inserted out of chronological order to prove seq follows received_at,
	// not insertion order.
	insertPreMigrationEvent(t, testDB, newer, "todo_list.created", uuid.New(), "todo_list",
		`{"name":"B"}`, base.Add(time.Second), true)
	insertPreMigrationEvent(t, testDB, older, "todo_list.created", uuid.New(), "todo_list",
		`{"name":"A"}`, base, true)
	insertPreMigrationEvent(t, testDB, unprocessed, "todo_list.created", uuid.New(), "todo_list",
		`{"name":"C"}`, base.Add(2*time.Second), false)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	olderSeq := querySeq(t, testDB, older)
	newerSeq := querySeq(t, testDB, newer)
	unprocessedSeq := querySeq(t, testDB, unprocessed)

	require.NotNil(t, olderSeq)
	require.NotNil(t, newerSeq)
	assert.Less(t, *olderSeq, *newerSeq)
	assert.Nil(t, unprocessedSeq, "unprocessed events must not get a seq")
}

func TestMigration00004_SequenceContinuesAfterBackfill(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00003-events-processed-at.up.sql")
	defer testDB.Close(t)

	first := uuid.New()
	second := uuid.New()
	base := time.Now().UTC()
	insertPreMigrationEvent(t, testDB, first, "todo_list.created", uuid.New(), "todo_list",
		`{"name":"A"}`, base, true)
	insertPreMigrationEvent(t, testDB, second, "todo_list.created", uuid.New(), "todo_list",
		`{"name":"B"}`, base.Add(time.Second), true)

	testDB.ApplyMigration(t, "00004-events-list-id-and-seq.up.sql")

	backfilledMax := querySeq(t, testDB, second)
	require.NotNil(t, backfilledMax)

	var nextSeq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT nextval('events_seq_seq')`).Scan(&nextSeq)
	require.NoError(t, err)

	assert.Equal(t, *backfilledMax+1, nextSeq)
}

func TestMigration00004_DoesNotFailOnAFreshEmptyDatabase(t *testing.T) {
	// Pinned to 00004 itself, not SetupTestDB's full HEAD chain: HEAD no
	// longer has events_seq_seq at all (see migration
	// 00009-log-only-server), so this test - specific to 00004's guarded
	// setval() on an empty DB - has to stop here to still mean anything.
	// Equivalent to a fresh install at that point in the chain, which is
	// exactly the case the conditional setval() guards against.
	testDB := testhelpers.SetupTestDBAtMigration(t, "00004-events-list-id-and-seq.up.sql")
	defer testDB.Close(t)

	var nextSeq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT nextval('events_seq_seq')`).Scan(&nextSeq)
	require.NoError(t, err)
	assert.Equal(t, int64(1), nextSeq)
}

func queryListID(t *testing.T, testDB *testhelpers.PostgresTestContainer, eventID uuid.UUID) *uuid.UUID {
	var listID pgtype.UUID
	err := testDB.Conn.QueryRow(context.Background(),
		`SELECT list_id FROM events WHERE id = $1`, eventID).Scan(&listID)
	require.NoError(t, err)
	return uuidPtrFromPgtype(listID)
}

func querySeq(t *testing.T, testDB *testhelpers.PostgresTestContainer, eventID uuid.UUID) *int64 {
	var seq pgtype.Int8
	err := testDB.Conn.QueryRow(context.Background(),
		`SELECT seq FROM events WHERE id = $1`, eventID).Scan(&seq)
	require.NoError(t, err)
	if !seq.Valid {
		return nil
	}
	return &seq.Int64
}
