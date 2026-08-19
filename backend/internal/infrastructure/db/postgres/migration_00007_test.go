package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

// TestMigration00007Down_SucceedsWithAListMembersRowThatHasNoTodoListsRow is
// the regression test for a review finding: 00007's up migration explicitly
// allows list_members/list_invites rows for a list_id todo_lists has never
// seen (access is claimed synchronously at push time, before any todo_lists
// row exists). Restoring the FK on down without first removing such rows
// fails the moment one exists - i.e. after the very first push of any new
// list, not some rare edge case.
func TestMigration00007Down_SucceedsWithAListMembersRowThatHasNoTodoListsRow(t *testing.T) {
	// Pinned to 00007's own schema: a down-migration test must run against
	// the schema that migration created, not whatever HEAD looks like today.
	testDB := testhelpers.SetupTestDBAtMigration(t, "00007-list-access-enforcement.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, 'alice', 'owner', NOW())`,
		listID,
	)
	require.NoError(t, err, "seeding an owner row for a list with no todo_lists projection must succeed on the up schema")

	testDB.ApplyMigration(t, "00007-list-access-enforcement.down.sql")

	var count int
	err = testDB.Conn.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM list_members WHERE list_id = $1`, listID).Scan(&count)
	require.NoError(t, err)
	require.Equal(t, 0, count, "the down migration discards access rows that never got a todo_lists projection - documented data loss, not a bug")
}

// TestMigration00007Down_SucceedsWithAListInvitesRowThatHasNoTodoListsRow
// mirrors the list_members case above for list_invites, which lost the same
// FK in the up migration for the same reason.
func TestMigration00007Down_SucceedsWithAListInvitesRowThatHasNoTodoListsRow(t *testing.T) {
	// Pinned to 00007's own schema: a down-migration test must run against
	// the schema that migration created, not whatever HEAD looks like today.
	testDB := testhelpers.SetupTestDBAtMigration(t, "00007-list-access-enforcement.up.sql")
	defer testDB.Close(t)

	listID := uuid.New()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
		 VALUES ($1, $2, 'hash', 'alice', NOW(), NOW() + interval '1 day')`,
		uuid.New(), listID,
	)
	require.NoError(t, err, "seeding an invite for a list with no todo_lists projection must succeed on the up schema")

	testDB.ApplyMigration(t, "00007-list-access-enforcement.down.sql")

	var count int
	err = testDB.Conn.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM list_invites WHERE list_id = $1`, listID).Scan(&count)
	require.NoError(t, err)
	require.Equal(t, 0, count)
}

// TestMigration00007Down_RestoresTheForeignKeys checks the down migration
// actually put the constraints back, not just that it didn't error - a
// dropped-and-never-restored FK would pass the two tests above too.
func TestMigration00007Down_RestoresTheForeignKeys(t *testing.T) {
	// Pinned to 00007's own schema: a down-migration test must run against
	// the schema that migration created, not whatever HEAD looks like today.
	testDB := testhelpers.SetupTestDBAtMigration(t, "00007-list-access-enforcement.up.sql")
	defer testDB.Close(t)

	testDB.ApplyMigration(t, "00007-list-access-enforcement.down.sql")

	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, 'alice', 'owner', NOW())`,
		uuid.New(),
	)
	require.Error(t, err, "the FK to todo_lists should be back after the down migration")
}
