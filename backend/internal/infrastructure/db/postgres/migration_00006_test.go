package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

// insertPreSeqAtInsertEvent inserts a row using the schema as it existed
// through migration 00005 (seq only ever set by MarkEventProcessed) - the
// shape any row created before migration 00006 would actually have: a
// processed row always has seq, an unprocessed row never does.
func insertPreSeqAtInsertEvent(
	t *testing.T,
	testDB *testhelpers.PostgresTestContainer,
	id uuid.UUID,
	receivedAt time.Time,
	processed bool,
) {
	var processedAt, seq any
	if processed {
		processedAt = receivedAt
		seq = nextSeqForTest(t, testDB)
	}
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO events (id, event_type, aggregate_id, aggregate_type, payload, occurred_at, received_at, client_id, processed_at, seq)
		 VALUES ($1, 'todo_list.created', $2, 'todo_list', '{"name":"Rewe"}', $3, $3, 'client-1', $4, $5)`,
		id, uuid.New(), receivedAt, processedAt, seq,
	)
	require.NoError(t, err)
}

func nextSeqForTest(t *testing.T, testDB *testhelpers.PostgresTestContainer) int64 {
	var seq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT nextval('events_seq_seq')`).Scan(&seq)
	require.NoError(t, err)
	return seq
}

func TestMigration00006_BackfillsSeqForUnprocessedRowsInReceivedOrder(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00005-list-sharing.up.sql")
	defer testDB.Close(t)

	base := time.Now().UTC()
	older := uuid.New()
	newer := uuid.New()

	// Inserted out of chronological order to prove seq follows received_at,
	// not insertion order - same shape as migration 00004's own backfill
	// test.
	insertPreSeqAtInsertEvent(t, testDB, newer, base.Add(time.Second), false)
	insertPreSeqAtInsertEvent(t, testDB, older, base, false)

	testDB.ApplyMigration(t, "00006-events-seq-at-insert.up.sql")

	olderSeq := querySeq(t, testDB, older)
	newerSeq := querySeq(t, testDB, newer)

	require.NotNil(t, olderSeq)
	require.NotNil(t, newerSeq)
	assert.Less(t, *olderSeq, *newerSeq)
}

func TestMigration00006_DoesNotReassignSeqForAlreadyProcessedRows(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00005-list-sharing.up.sql")
	defer testDB.Close(t)

	id := uuid.New()
	insertPreSeqAtInsertEvent(t, testDB, id, time.Now().UTC(), true)
	before := querySeq(t, testDB, id)
	require.NotNil(t, before)

	testDB.ApplyMigration(t, "00006-events-seq-at-insert.up.sql")

	after := querySeq(t, testDB, id)
	require.NotNil(t, after)
	assert.Equal(t, *before, *after)
}

func TestMigration00006_SequenceContinuesAfterBackfill(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00005-list-sharing.up.sql")
	defer testDB.Close(t)

	unprocessed := uuid.New()
	insertPreSeqAtInsertEvent(t, testDB, unprocessed, time.Now().UTC(), false)

	testDB.ApplyMigration(t, "00006-events-seq-at-insert.up.sql")

	backfilled := querySeq(t, testDB, unprocessed)
	require.NotNil(t, backfilled)

	var nextSeq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT nextval('events_seq_seq')`).Scan(&nextSeq)
	require.NoError(t, err)

	assert.Equal(t, *backfilled+1, nextSeq)
}

// TestMigration00006_BackfillsLastAppliedSeqFromProcessedEvents is the
// projection-side half: a list's existing row must start out at least as
// current as the highest seq it already reflects, so a replay right after
// deploy can't undo it.
func TestMigration00006_BackfillsLastAppliedSeqFromProcessedEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00005-list-sharing.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, 'Rewe', NOW(), NOW())`,
		listID,
	)
	require.NoError(t, err)

	seq := nextSeqForTest(t, testDB)
	_, err = testDB.Conn.Exec(context.Background(),
		`INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, received_at, client_id, processed_at, seq)
		 VALUES ($1, 'todo_list.updated', $2, 'todo_list', $2, '{"name":"Rewe"}', NOW(), NOW(), 'client-1', NOW(), $3)`,
		uuid.New(), listID, seq,
	)
	require.NoError(t, err)

	testDB.ApplyMigration(t, "00006-events-seq-at-insert.up.sql")

	var lastAppliedSeq int64
	err = testDB.Conn.QueryRow(context.Background(),
		`SELECT last_applied_seq FROM todo_lists WHERE id = $1`, listID).Scan(&lastAppliedSeq)
	require.NoError(t, err)
	assert.Equal(t, seq, lastAppliedSeq)
}

func TestMigration00006_LastAppliedSeqDefaultsToZeroForAListWithNoEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00005-list-sharing.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, 'Rewe', NOW(), NOW())`,
		listID,
	)
	require.NoError(t, err)

	testDB.ApplyMigration(t, "00006-events-seq-at-insert.up.sql")

	var lastAppliedSeq int64
	err = testDB.Conn.QueryRow(context.Background(),
		`SELECT last_applied_seq FROM todo_lists WHERE id = $1`, listID).Scan(&lastAppliedSeq)
	require.NoError(t, err)
	assert.Equal(t, int64(0), lastAppliedSeq)
}

func TestMigration00006_DoesNotFailOnAFreshEmptyDatabase(t *testing.T) {
	// SetupTestDB runs the full chain including 00006 with zero pre-existing
	// rows - equivalent to a fresh install, exactly the case the
	// conditional setval() guards against (same rationale as migration
	// 00004's own equivalent test).
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	var nextSeq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT nextval('events_seq_seq')`).Scan(&nextSeq)
	require.NoError(t, err)
	assert.Equal(t, int64(1), nextSeq)
}
