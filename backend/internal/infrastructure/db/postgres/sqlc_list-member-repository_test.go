package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_FirstCallClaimsOwnership(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := createTestToDoList(t, testDB)

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "alice", time.Now().UTC())
	require.NoError(t, err)
	assert.True(t, claimed)

	member, err := repo.FindByListAndUser(ctx, listID, "alice")
	require.NoError(t, err)
	require.NotNil(t, member)
	assert.Equal(t, entities.RoleOwner, member.Role)
	assert.Nil(t, member.InviteID)
}

func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_SecondCallDoesNotClaim(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := createTestToDoList(t, testDB)

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "alice", time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)

	// Even a different user's attempt must not succeed once someone already
	// has membership - claim-on-first-invite is a bootstrap, not a way to
	// add a second owner.
	claimedAgain, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "bob", time.Now().UTC())
	require.NoError(t, err)
	assert.False(t, claimedAgain)

	bob, err := repo.FindByListAndUser(ctx, listID, "bob")
	require.NoError(t, err)
	assert.Nil(t, bob)
}

func TestSqlcListMemberRepository_Add_InsertsMemberWithInviteID(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := createTestToDoList(t, testDB)
	inviteID := uuid.New()
	now := time.Now().UTC().Truncate(time.Millisecond)

	member, err := entities.NewListMember(listID, "bob", entities.RoleMember, now, &inviteID)
	require.NoError(t, err)
	require.NoError(t, repo.Add(ctx, member))

	found, err := repo.FindByListAndUser(ctx, listID, "bob")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, entities.RoleMember, found.Role)
	require.NotNil(t, found.InviteID)
	assert.Equal(t, inviteID, *found.InviteID)
	assert.True(t, found.JoinedAt.Equal(now))
}

func TestSqlcListMemberRepository_Add_TwiceIsANoOpWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := createTestToDoList(t, testDB)

	first, err := entities.NewListMember(listID, "bob", entities.RoleMember, time.Now().UTC().Truncate(time.Millisecond), nil)
	require.NoError(t, err)
	require.NoError(t, repo.Add(ctx, first))

	// A second Add for the same (list_id, user_id) - e.g. a redeem retry -
	// must not error (PK violation) or change the stored row.
	second, err := entities.NewListMember(listID, "bob", entities.RoleMember, time.Now().UTC().Add(time.Hour), nil)
	require.NoError(t, err)
	require.NoError(t, repo.Add(ctx, second))

	found, err := repo.FindByListAndUser(ctx, listID, "bob")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.True(t, found.JoinedAt.Equal(first.JoinedAt))
}

func TestSqlcListMemberRepository_FindByListAndUser_UnknownReturnsNilWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	listID := createTestToDoList(t, testDB)

	found, err := repo.FindByListAndUser(context.Background(), listID, "nobody")

	require.NoError(t, err)
	assert.Nil(t, found)
}
