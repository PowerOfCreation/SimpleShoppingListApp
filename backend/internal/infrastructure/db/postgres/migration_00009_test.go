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

// insertRegisteredList seeds a bare synced_lists row - the pre-head_seq
// shape at migration 00008, before this migration adds the column.
func insertRegisteredList(t *testing.T, testDB *testhelpers.PostgresTestContainer, id uuid.UUID) {
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO synced_lists (id, created_at) VALUES ($1, NOW())`, id)
	require.NoError(t, err)
}

// insertPreRenumberEvent seeds an events row with an explicit, caller-chosen
// seq - standing in for the global events_seq_seq-assigned values this
// migration renumbers per list.
func insertPreRenumberEvent(t *testing.T, testDB *testhelpers.PostgresTestContainer, id, listID uuid.UUID, seq int64) {
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, received_at, client_id, seq)
		 VALUES ($1, 'ingredient.created', $2, 'ingredient', $2, '{"name":"Milk"}', NOW(), NOW(), 'client-1', $3)`,
		id, listID, seq,
	)
	require.NoError(t, err)
}

func querySeqByID(t *testing.T, testDB *testhelpers.PostgresTestContainer, id uuid.UUID) int64 {
	var seq int64
	err := testDB.Conn.QueryRow(context.Background(), `SELECT seq FROM events WHERE id = $1`, id).Scan(&seq)
	require.NoError(t, err)
	return seq
}

func queryHeadSeq(t *testing.T, testDB *testhelpers.PostgresTestContainer, listID uuid.UUID) int64 {
	var headSeq int64
	err := testDB.Conn.QueryRow(context.Background(),
		`SELECT head_seq FROM synced_lists WHERE id = $1`, listID).Scan(&headSeq)
	require.NoError(t, err)
	return headSeq
}

// TestMigration00009_RenumbersSeqPerListPreservingRelativeOrder seeds two
// lists whose seq values interleave under the old global sequence (A, B, A,
// B, ...) and checks that after renumbering, each list's own events are
// still in the same relative order to each other - only the numbers
// compress down to that list's own 1..N.
func TestMigration00009_RenumbersSeqPerListPreservingRelativeOrder(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00008-list-registry.up.sql")
	defer testDB.Close(t)

	listA, listB := uuid.New(), uuid.New()
	insertRegisteredList(t, testDB, listA)
	insertRegisteredList(t, testDB, listB)

	aFirst, aSecond := uuid.New(), uuid.New()
	bFirst, bSecond := uuid.New(), uuid.New()
	insertPreRenumberEvent(t, testDB, aFirst, listA, 1)
	insertPreRenumberEvent(t, testDB, bFirst, listB, 2)
	insertPreRenumberEvent(t, testDB, aSecond, listA, 3)
	insertPreRenumberEvent(t, testDB, bSecond, listB, 4)

	testDB.ApplyMigration(t, "00009-log-only-server.up.sql")

	assert.Equal(t, int64(1), querySeqByID(t, testDB, aFirst))
	assert.Equal(t, int64(2), querySeqByID(t, testDB, aSecond))
	assert.Equal(t, int64(1), querySeqByID(t, testDB, bFirst))
	assert.Equal(t, int64(2), querySeqByID(t, testDB, bSecond))
}

func TestMigration00009_SetsHeadSeqToTheRenumberedMaxPerList(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00008-list-registry.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	insertRegisteredList(t, testDB, listID)
	insertPreRenumberEvent(t, testDB, uuid.New(), listID, 5)
	insertPreRenumberEvent(t, testDB, uuid.New(), listID, 9)

	testDB.ApplyMigration(t, "00009-log-only-server.up.sql")

	assert.Equal(t, int64(2), queryHeadSeq(t, testDB, listID))
}

func TestMigration00009_SetsHeadSeqToZeroForARegisteredListWithNoEvents(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00008-list-registry.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	insertRegisteredList(t, testDB, listID)

	testDB.ApplyMigration(t, "00009-log-only-server.up.sql")

	assert.Equal(t, int64(0), queryHeadSeq(t, testDB, listID))
}

// TestMigration00009_DropsTodoListsAndTodos is the destructive half of this
// migration: the content projection and its child table must be gone
// afterward, since nothing reads them any more (requireList and
// GetListHeads moved to the registry in the preceding steps).
func TestMigration00009_DropsTodoListsAndTodos(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00008-list-registry.up.sql")
	defer testDB.Close(t)

	testDB.ApplyMigration(t, "00009-log-only-server.up.sql")

	_, err := testDB.Conn.Exec(context.Background(), `SELECT 1 FROM todo_lists`)
	assert.Error(t, err, "todo_lists must not exist after this migration")

	_, err = testDB.Conn.Exec(context.Background(), `SELECT 1 FROM todos`)
	assert.Error(t, err, "todos must not exist after this migration")
}

func TestMigration00009_DropsProcessedAt(t *testing.T) {
	testDB := testhelpers.SetupTestDBAtMigration(t, "00008-list-registry.up.sql")
	defer testDB.Close(t)

	testDB.ApplyMigration(t, "00009-log-only-server.up.sql")

	_, err := testDB.Conn.Exec(context.Background(), `SELECT processed_at FROM events LIMIT 1`)
	assert.Error(t, err, "processed_at must not exist after this migration - nothing left reads it")
}

func TestMigration00009_DoesNotFailOnAFreshEmptyDatabase(t *testing.T) {
	// SetupTestDB runs the full chain including 00009 with zero
	// pre-existing rows - equivalent to a fresh install.
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	listID := uuid.New()
	insertRegisteredList(t, testDB, listID)
	assert.Equal(t, int64(0), queryHeadSeq(t, testDB, listID))
}

// TestMigration00009Down_RestoresTheSchemaForEarlierDownMigrations proves
// the schema-only rollback promise: 00007's own down migration references
// todo_lists directly, so it must exist again (even empty) once 00009's
// down has run, for the chain to keep working backwards in order - 00008's
// down first (dropping the registry and its FKs), then 00007's.
func TestMigration00009Down_RestoresTheSchemaForEarlierDownMigrations(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	testDB.ApplyMigration(t, "00009-log-only-server.down.sql")

	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, 'Rewe', $2, $2)`,
		uuid.New(), time.Now().UTC())
	require.NoError(t, err, "todo_lists must exist and accept a row again after the down migration")

	testDB.ApplyMigration(t, "00008-list-registry.down.sql")
	testDB.ApplyMigration(t, "00007-list-access-enforcement.down.sql")
}
