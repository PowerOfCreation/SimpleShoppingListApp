package postgres

import (
	"context"
	"fmt"
	"sync"
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

// TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_ConcurrentClaimsProduceExactlyOneOwner
// is the test idx_list_members_single_owner (00010) exists for: N different
// users racing ClaimOwnershipIfUnowned for the same fresh list must yield
// exactly one winner and zero errors - the loser's 23505 (from the index,
// since each goroutine uses a distinct user_id so the list_members PK can't
// be what fires) has to be swallowed into claimed=false, not surfaced.
func TestSqlcListMemberRepository_ClaimOwnershipIfUnowned_ConcurrentClaimsProduceExactlyOneOwner(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)
	ctx := context.Background()

	// A single *pgx.Conn (testDB.Conn) is documented as unsafe for
	// concurrent use, so this needs a real pool - see the same reasoning in
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

	const concurrency = 10
	var wg sync.WaitGroup
	errs := make([]error, concurrency)
	claims := make([]bool, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			claimed, err := repo.ClaimOwnershipIfUnowned(ctx, listID, fmt.Sprintf("user-%d", idx), time.Now().UTC())
			errs[idx] = err
			claims[idx] = claimed
		}(i)
	}
	wg.Wait()

	winners := 0
	for i, err := range errs {
		require.NoError(t, err, "goroutine %d failed", i)
		if claims[i] {
			winners++
		}
	}
	assert.Equal(t, 1, winners, "exactly one goroutine must win the claim")

	var owners int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM list_members WHERE list_id = $1 AND role = 'owner'`, listID).Scan(&owners))
	assert.Equal(t, 1, owners, "exactly one owner row must exist in the database")
}
