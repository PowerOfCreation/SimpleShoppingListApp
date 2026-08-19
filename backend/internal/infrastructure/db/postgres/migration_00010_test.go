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

// setupAt00009 pins these tests to the schema 00010 actually migrates from.
func setupAt00009(t *testing.T) *testhelpers.PostgresTestContainer {
	t.Helper()
	return testhelpers.SetupTestDBAtMigration(t, "00009-log-only-server.up.sql")
}

func insertListMember(
	t *testing.T,
	testDB *testhelpers.PostgresTestContainer,
	listID uuid.UUID,
	userID, role string,
) error {
	t.Helper()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
		listID, userID, role, time.Now().UTC())
	return err
}

// A second owner row for the same list is exactly the race this migration
// closes: idx_list_members_single_owner must reject it even though
// list_members' primary key (list_id, user_id) doesn't, since the two rows
// have different user_ids.
func TestMigration00010_RejectsASecondOwnerForTheSameList(t *testing.T) {
	testDB := setupAt00009(t)
	defer testDB.Close(t)
	testDB.ApplyMigration(t, "00010-single-owner-per-list.up.sql")

	listID := registerTestList(t, testDB)
	require.NoError(t, insertListMember(t, testDB, listID, "alice", "owner"))

	err := insertListMember(t, testDB, listID, "bob", "owner")
	assert.Error(t, err, "a second owner row for the same list must be rejected")
}

// The index is partial on role = 'owner', so members are unaffected -
// a list can still have any number of member rows alongside its one owner.
func TestMigration00010_StillAllowsMultipleMembersForTheSameList(t *testing.T) {
	testDB := setupAt00009(t)
	defer testDB.Close(t)
	testDB.ApplyMigration(t, "00010-single-owner-per-list.up.sql")

	listID := registerTestList(t, testDB)
	require.NoError(t, insertListMember(t, testDB, listID, "alice", "owner"))

	err := insertListMember(t, testDB, listID, "bob", "member")
	assert.NoError(t, err, "a member row alongside the owner must still be allowed")
}

// The index is keyed on list_id, so it must not stop two different lists
// from each having their own, independent owner.
func TestMigration00010_StillAllowsOwnersOfDifferentLists(t *testing.T) {
	testDB := setupAt00009(t)
	defer testDB.Close(t)
	testDB.ApplyMigration(t, "00010-single-owner-per-list.up.sql")

	listA := registerTestList(t, testDB)
	listB := registerTestList(t, testDB)
	require.NoError(t, insertListMember(t, testDB, listA, "alice", "owner"))

	err := insertListMember(t, testDB, listB, "bob", "owner")
	assert.NoError(t, err, "owners of different lists must not conflict")
}
