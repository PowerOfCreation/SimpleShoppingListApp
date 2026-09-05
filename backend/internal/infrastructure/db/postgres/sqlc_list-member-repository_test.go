package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_FirstCallClaimsOwnership(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

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
	listID := registerTestList(t, testDB)

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
	inviteRepo := NewSqlcListInviteRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	// list_members.invite_id has an FK to list_invites(id), so the invite
	// referenced here must actually exist.
	ttl, err := entities.ParseInviteTTL("1h")
	require.NoError(t, err)
	invite, _, err := entities.NewListInvite(listID, "alice", ttl, time.Now().UTC())
	require.NoError(t, err)
	require.NoError(t, inviteRepo.Create(ctx, invite))

	now := time.Now().UTC().Truncate(time.Millisecond)
	member, err := entities.NewListMember(listID, "bob", entities.RoleMember, now, &invite.ID)
	require.NoError(t, err)
	require.NoError(t, repo.Add(ctx, member))

	found, err := repo.FindByListAndUser(ctx, listID, "bob")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, entities.RoleMember, found.Role)
	require.NotNil(t, found.InviteID)
	assert.Equal(t, invite.ID, *found.InviteID)
	assert.True(t, found.JoinedAt.Equal(now))
}

func TestSqlcListMemberRepository_Add_TwiceIsANoOpWithoutError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

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
	listID := registerTestList(t, testDB)

	found, err := repo.FindByListAndUser(context.Background(), listID, "nobody")

	require.NoError(t, err)
	assert.Nil(t, found)
}

// TestSqlcListMemberRepository_FindByListAndUser_CorruptRoleReturnsError
// guards the second, independent layer of defense against an invalid role:
// even bypassing the DB's own CHECK constraint (simulating a hand-edited
// row, replicated data from a schema without the constraint, or a future
// migration that relaxes it incorrectly), the repository must refuse to
// hand back a ListMember with a role the domain doesn't recognize instead
// of silently propagating it - see entities.NewListMember.
func TestSqlcListMemberRepository_FindByListAndUser_CorruptRoleReturnsError(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()
	listID := registerTestList(t, testDB)

	_, err := testDB.Conn.Exec(ctx, "ALTER TABLE list_members DROP CONSTRAINT list_members_role_check")
	require.NoError(t, err)
	_, err = testDB.Conn.Exec(ctx,
		"INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES ($1, $2, $3, now())",
		listID, "corrupt-user", "not-a-real-role")
	require.NoError(t, err)

	_, err = repo.FindByListAndUser(ctx, listID, "corrupt-user")
	assert.Error(t, err)
}

// TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_DoesNotRequireATodoListsRow
// guards migration 00007: list_members.list_id no longer has a foreign key
// to todo_lists, precisely so a list can be claimed at push time, before
// its projection (todo_lists) necessarily exists (see
// ListAccessService.AuthorizeWrite and sync-sharing-target.md §2 on why
// access must not hang off a rebuildable projection).
func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_DoesNotRequireATodoListsRow(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	listID := uuid.New() // deliberately never inserted into todo_lists

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "alice", time.Now().UTC())
	require.NoError(t, err)
	assert.True(t, claimed)
}

func TestSqlcListMemberRepository_FindAccessibleListIDs_ReturnsOnlyListsTheUserIsAMemberOf(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	own := registerTestList(t, testDB)
	foreign := registerTestList(t, testDB)
	unknown := uuid.New()

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, own, "alice", time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)
	_, err = repo.ClaimOwnershipIfUnowned(ctx, foreign, "mallory", time.Now().UTC())
	require.NoError(t, err)

	accessible, err := repo.FindAccessibleListIDs(ctx, "alice", []uuid.UUID{own, foreign, unknown})

	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{own}, accessible)
}

func TestSqlcListMemberRepository_FindAccessibleListIDs_EmptyInputReturnsNil(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))

	accessible, err := repo.FindAccessibleListIDs(context.Background(), "alice", nil)

	require.NoError(t, err)
	assert.Empty(t, accessible)
}

// TestSqlcListMemberRepository_FindClaimedListIDs_ReturnsListsWithAnyMemberRegardlessOfWho
// is the repository-level coverage behind ListAccessService.AuthorizeWrite's
// claim pre-check (see PR #249 review): it must report a list as "claimed"
// even when the caller asking isn't the member who claimed it, since that's
// exactly the distinction the pre-check needs ("nobody's pushed yet" vs.
// "someone else already owns it").
func TestSqlcListMemberRepository_FindClaimedListIDs_ReturnsListsWithAnyMemberRegardlessOfWho(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	claimedByOther := registerTestList(t, testDB)
	unclaimed := registerTestList(t, testDB)

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, claimedByOther, "mallory", time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)

	result, err := repo.FindClaimedListIDs(ctx, []uuid.UUID{claimedByOther, unclaimed})

	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{claimedByOther}, result)
}

func TestSqlcListMemberRepository_FindClaimedListIDs_EmptyInputReturnsNil(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))

	result, err := repo.FindClaimedListIDs(context.Background(), nil)

	require.NoError(t, err)
	assert.Empty(t, result)
}

// The real push path claims a list the registry has never seen - that's the
// whole point of claim-on-first-push. Registering it has to happen in the
// same statement as the claim, or the foreign key added in 00008 makes the
// claim fail outright and a list could never be created at all.
func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_RegistersAnUnknownList(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	registry := NewSqlcSyncedListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	listID := uuid.New()
	known, err := registry.Exists(ctx, listID)
	require.NoError(t, err)
	require.False(t, known, "precondition: the server has never seen this list")

	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "alice", time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)

	known, err = registry.Exists(ctx, listID)
	require.NoError(t, err)
	assert.True(t, known, "claiming a list must register it in the same statement")
}

// A claim that loses the race writes no membership - and must not leave a
// registry row behind either way, since the list is registered exactly when
// someone owns it.
func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_LosingClaimKeepsTheRegistryConsistent(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	registry := NewSqlcSyncedListRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	listID := uuid.New()
	claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "alice", time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)

	claimed, err = repo.ClaimOwnershipIfUnowned(ctx, listID, "mallory", time.Now().UTC())
	require.NoError(t, err)
	require.False(t, claimed, "the list already has an owner")

	known, err := registry.Exists(ctx, listID)
	require.NoError(t, err)
	assert.True(t, known, "the registry row stays - it belongs to alice's claim")

	member, err := repo.FindByListAndUser(ctx, listID, "mallory")
	require.NoError(t, err)
	assert.Nil(t, member)
}

// TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_LoserOfADeterministicRaceLosesCleanly
// is the regression test for idx_list_members_single_owner (00010) and the
// 23505 mapping together. It doesn't rely on goroutine-start jitter to hit
// the race window - a plain N-goroutine test reliably serializes instead of
// racing, because the gap between ClaimListOwnership's NOT EXISTS check and
// its own commit is sub-millisecond, far shorter than the time it takes a
// second goroutine to even get scheduled. Instead it forces the exact
// interleaving with two explicit transactions: txA claims but doesn't
// commit, leaving an owner row that's invisible to any NOT EXISTS run from
// outside txA; user-b's autocommit claim therefore also attempts the
// INSERT and blocks on the unique index against txA's uncommitted key.
// Only once txA commits does user-b's INSERT get to run - and fail with
// 23505.
func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_LoserOfADeterministicRaceLosesCleanly(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	ctx := context.Background()

	// A single *pgx.Conn (testDB.Conn) can't run two overlapping
	// transactions at once, so this needs a real pool - see the same
	// reasoning in
	// TestSqlcEventRepository_AppendToList_ConcurrentAppendsForSameListProduceGapfreeUniqueSeq.
	dsn := testDB.Container.(interface {
		ConnectionString(ctx context.Context, args ...string) (string, error)
	})
	connString, err := dsn.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)
	pool, err := NewConnection(ctx, connString)
	require.NoError(t, err)
	defer pool.Close()

	repo := NewSqlcListMemberRepository(NewQueries(pool))
	listID := uuid.New()
	now := time.Now().UTC()

	txA, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer txA.Rollback(ctx) // safety net only - a no-op once committed below

	_, err = NewQueries(pool).WithTx(txA).ClaimListOwnership(ctx, db.ClaimListOwnershipParams{
		ListID:   listID,
		UserID:   "user-a",
		JoinedAt: timestamptzFromTime(now),
	})
	require.NoError(t, err, "txA's own claim must succeed uncommitted")

	type result struct {
		claimed bool
		err     error
	}
	resultCh := make(chan result, 1)
	go func() {
		claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, "user-b", now)
		resultCh <- result{claimed, err}
	}()

	time.Sleep(100 * time.Millisecond) // let user-b reach and block on the index before we commit
	require.NoError(t, txA.Commit(ctx))

	select {
	case res := <-resultCh:
		require.NoError(t, res.err, "the loser's unique violation must be swallowed, not surfaced")
		assert.False(t, res.claimed, "user-b must lose once user-a's claim commits")
	case <-time.After(10 * time.Second):
		t.Fatal("user-b's claim never returned - it's likely blocked on the index forever")
	}

	var owners int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_members WHERE list_id = $1 AND role = 'owner'`, listID).Scan(&owners))
	assert.Equal(t, 1, owners, "exactly one owner row must exist")

	owner, err := repo.FindByListAndUser(ctx, listID, "user-a")
	require.NoError(t, err)
	require.NotNil(t, owner, "the committed claim (user-a) must be the one that stuck")
}

func TestSqlcListMemberRepository_FindListsForUser_ReturnsEveryListRegardlessOfRole(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))
	ctx := context.Background()

	owned := registerTestList(t, testDB)
	joined := registerTestList(t, testDB)
	unrelated := registerTestList(t, testDB)

	_, err := repo.ClaimOwnershipIfUnowned(ctx, owned, "alice", time.Now().UTC())
	require.NoError(t, err)
	_, err = repo.ClaimOwnershipIfUnowned(ctx, joined, "mallory", time.Now().UTC())
	require.NoError(t, err)
	member, err := entities.NewListMember(joined, "alice", entities.RoleMember, time.Now().UTC().Truncate(time.Millisecond), nil)
	require.NoError(t, err)
	require.NoError(t, repo.Add(ctx, member))
	_, err = repo.ClaimOwnershipIfUnowned(ctx, unrelated, "mallory", time.Now().UTC())
	require.NoError(t, err)

	lists, err := repo.FindListsForUser(ctx, "alice")

	require.NoError(t, err)
	require.Len(t, lists, 2)
	byListID := make(map[uuid.UUID]entities.ListMemberRole, len(lists))
	for _, m := range lists {
		byListID[m.ListID] = m.Role
	}
	assert.Equal(t, entities.RoleOwner, byListID[owned])
	assert.Equal(t, entities.RoleMember, byListID[joined])
	assert.NotContains(t, byListID, unrelated)
}

func TestSqlcListMemberRepository_FindListsForUser_UnknownUserReturnsEmpty(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	repo := NewSqlcListMemberRepository(NewQueries(testDB.Conn))

	lists, err := repo.FindListsForUser(context.Background(), "nobody")

	require.NoError(t, err)
	assert.Empty(t, lists)
}
