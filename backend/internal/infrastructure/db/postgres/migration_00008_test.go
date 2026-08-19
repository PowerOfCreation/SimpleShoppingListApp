package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

// setupAt00007 pins these tests to the schema 00008 actually migrates from,
// so they keep testing the backfill rather than whatever HEAD looks like.
func setupAt00007(t *testing.T) *testhelpers.PostgresTestContainer {
	t.Helper()
	return testhelpers.SetupTestDBAtMigration(t, "00007-list-access-enforcement.up.sql")
}

func registryHas(t *testing.T, testDB *testhelpers.PostgresTestContainer, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	err := testDB.Conn.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM synced_lists WHERE id = $1)`, id).Scan(&exists)
	require.NoError(t, err)
	return exists
}

// The registry has to be backfilled from every source that can name a list
// today, because no single one is complete: todo_lists has a row only for
// lists whose projection succeeded, events.list_id only for lists whose
// list_id 00004 could resolve, and list_members/list_invites can name a
// list neither of the other two ever saw (that's exactly why 00007 had to
// drop their foreign keys). Missing any source would leave an access row
// orphaned and make 00008's foreign keys unaddable.
func TestMigration00008_BackfillsTheRegistryFromEverySource(t *testing.T) {
	testDB := setupAt00007(t)
	defer testDB.Close(t)
	ctx := context.Background()
	now := time.Now().UTC()

	fromProjection := uuid.New()
	_, err := testDB.Conn.Exec(ctx,
		`INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, 'Rewe', $2, $2)`,
		fromProjection, now)
	require.NoError(t, err)

	fromEvents := uuid.New()
	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id, seq)
		 VALUES ($1, 'todo_list.created', $2, 'todo_list', $2, '{}', $3, 'client-1', 1)`,
		uuid.New(), fromEvents, now)
	require.NoError(t, err)

	fromMembers := uuid.New()
	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, 'alice', 'owner', $2)`,
		fromMembers, now)
	require.NoError(t, err)

	fromInvites := uuid.New()
	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
		 VALUES ($1, $2, 'hash-1', 'alice', $3::timestamptz, $3::timestamptz + interval '1 hour')`,
		uuid.New(), fromInvites, now)
	require.NoError(t, err)

	testDB.ApplyMigration(t, "00008-list-registry.up.sql")

	require.True(t, registryHas(t, testDB, fromProjection), "a list with a todo_lists row must be registered")
	require.True(t, registryHas(t, testDB, fromEvents), "a list known only from the event log must be registered")
	require.True(t, registryHas(t, testDB, fromMembers), "a list known only from a membership must be registered")
	require.True(t, registryHas(t, testDB, fromInvites), "a list known only from an invite must be registered")
}

// Access rows must survive the migration untouched - unlike 00007's down,
// which deliberately discards them, 00008 registers their list instead.
func TestMigration00008_KeepsExistingAccessRows(t *testing.T) {
	testDB := setupAt00007(t)
	defer testDB.Close(t)
	ctx := context.Background()
	now := time.Now().UTC()

	listID := uuid.New()
	inviteID := uuid.New()
	_, err := testDB.Conn.Exec(ctx,
		`INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
		 VALUES ($1, $2, 'hash-1', 'alice', $3::timestamptz, $3::timestamptz + interval '1 hour')`,
		inviteID, listID, now)
	require.NoError(t, err)
	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO list_members (list_id, user_id, role, joined_at, invite_id) VALUES ($1, 'alice', 'owner', $2, $3)`,
		listID, now, inviteID)
	require.NoError(t, err)

	testDB.ApplyMigration(t, "00008-list-registry.up.sql")

	var members, invites int
	require.NoError(t, testDB.Conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_members WHERE list_id = $1`, listID).Scan(&members))
	require.NoError(t, testDB.Conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_invites WHERE list_id = $1`, listID).Scan(&invites))
	require.Equal(t, 1, members)
	require.Equal(t, 1, invites)
}

// The point of hanging the foreign keys off the registry rather than the
// projection: an access row for an unregistered list is now impossible,
// which is what makes "the server knows this list" a fact rather than a
// side effect of a projection that may or may not have been applied.
func TestMigration00008_RejectsAccessRowsForAnUnregisteredList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	ctx := context.Background()

	_, err := testDB.Conn.Exec(ctx,
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, 'alice', 'owner', NOW())`,
		uuid.New())
	require.Error(t, err, "a membership must not be insertable for a list the registry doesn't know")

	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
		 VALUES ($1, $2, 'hash-1', 'alice', NOW(), NOW() + interval '1 hour')`,
		uuid.New(), uuid.New())
	require.Error(t, err, "an invite must not be insertable for a list the registry doesn't know")
}

// Deleting the registry row is how "unsync this list" will eventually remove
// the server copy (sync-sharing-target.md 4.4); the cascade has to carry the
// access rows with it.
func TestMigration00008_DeletingARegistryRowCascadesToAccessRows(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	ctx := context.Background()

	listID := registerTestList(t, testDB)
	inviteID := uuid.New()
	_, err := testDB.Conn.Exec(ctx,
		`INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
		 VALUES ($1, $2, 'hash-1', 'alice', NOW(), NOW() + interval '1 hour')`,
		inviteID, listID)
	require.NoError(t, err)
	_, err = testDB.Conn.Exec(ctx,
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, 'alice', 'owner', NOW())`,
		listID)
	require.NoError(t, err)

	_, err = testDB.Conn.Exec(ctx, `DELETE FROM synced_lists WHERE id = $1`, listID)
	require.NoError(t, err)

	var members, invites int
	require.NoError(t, testDB.Conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_members WHERE list_id = $1`, listID).Scan(&members))
	require.NoError(t, testDB.Conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_invites WHERE list_id = $1`, listID).Scan(&invites))
	require.Equal(t, 0, members)
	require.Equal(t, 0, invites)
}
