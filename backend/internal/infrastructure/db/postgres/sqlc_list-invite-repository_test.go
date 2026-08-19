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

// registerTestList inserts a minimal todo_lists row so list_invites/
// list_members FK constraints are satisfied - shared by every test in this
// package that needs a real list to attach sharing data to.
// registerTestList makes a list id known to the server the way the real push
// path does - a registry row, no content. Invites and memberships hang off
// this row via the foreign keys added in 00008.
func registerTestList(t *testing.T, testDB *testhelpers.PostgresTestContainer) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := testDB.Conn.Exec(context.Background(),
		`INSERT INTO synced_lists (id, created_at) VALUES ($1, $2)`, id, time.Now().UTC())
	require.NoError(t, err)
	return id
}

func TestSqlcListInviteRepository_Create_FindByID_Roundtrips(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	invite, token, err := entities.NewListInvite(listID, "alice", ttl, now)
	require.NoError(t, err)
	require.NotEmpty(t, token)

	require.NoError(t, repo.Create(ctx, invite))

	found, err := repo.FindByID(ctx, invite.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, invite.ID, found.ID)
	assert.Equal(t, listID, found.ListID)
	assert.Equal(t, invite.TokenHash, found.TokenHash)
	assert.Equal(t, "alice", found.CreatedBy)
	assert.True(t, found.CreatedAt.Equal(now))
	assert.Nil(t, found.RevokedAt)
}

func TestSqlcListInviteRepository_FindByID_UnknownIdReturnsNilWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))

	found, err := repo.FindByID(context.Background(), uuid.New())

	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestSqlcListInviteRepository_FindByTokenHash_OnlyMatchesTheExactHash(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	invite, token, err := entities.NewListInvite(listID, "alice", ttl, time.Now().UTC())
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, invite))

	found, err := repo.FindByTokenHash(ctx, entities.HashInviteToken(string(token)))
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, invite.ID, found.ID)

	notFound, err := repo.FindByTokenHash(ctx, entities.HashInviteToken("wrong-token"))
	require.NoError(t, err)
	assert.Nil(t, notFound)
}

func TestSqlcListInviteRepository_FindActiveByList_FiltersRevokedAndExpiredAndOtherLists(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)
	otherListID := registerTestList(t, testDB)

	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	now := time.Now().UTC()

	active, _, err := entities.NewListInvite(listID, "alice", ttl, now)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, active))

	toRevoke, _, err := entities.NewListInvite(listID, "alice", ttl, now)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, toRevoke))
	require.NoError(t, repo.Revoke(ctx, toRevoke.ID, now))

	expired, _, err := entities.NewListInvite(listID, "alice", ttl, now.Add(-2*time.Hour))
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, expired))

	forOtherList, _, err := entities.NewListInvite(otherListID, "alice", ttl, now)
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, forOtherList))

	results, err := repo.FindActiveByList(ctx, listID, now)
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, active.ID, results[0].ID)
}

func TestSqlcListInviteRepository_Revoke_SetsRevokedAt(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	invite, _, err := entities.NewListInvite(listID, "alice", ttl, time.Now().UTC())
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, invite))

	revokedAt := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, repo.Revoke(ctx, invite.ID, revokedAt))

	found, err := repo.FindByID(ctx, invite.ID)
	require.NoError(t, err)
	require.NotNil(t, found.RevokedAt)
	assert.True(t, found.RevokedAt.Equal(revokedAt))
}

func TestSqlcListInviteRepository_Revoke_TwiceIsANoOpWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	invite, _, err := entities.NewListInvite(listID, "alice", ttl, time.Now().UTC())
	require.NoError(t, err)
	require.NoError(t, repo.Create(ctx, invite))

	first := time.Now().UTC().Truncate(time.Millisecond)
	require.NoError(t, repo.Revoke(ctx, invite.ID, first))
	second := first.Add(time.Minute)
	require.NoError(t, repo.Revoke(ctx, invite.ID, second))

	found, err := repo.FindByID(ctx, invite.ID)
	require.NoError(t, err)
	require.NotNil(t, found.RevokedAt)
	// The first revocation wins - RevokeListInvite guards on
	// `revoked_at IS NULL`.
	assert.True(t, found.RevokedAt.Equal(first))
}
