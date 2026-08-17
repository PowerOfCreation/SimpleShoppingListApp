package services

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

// fakeListInviteRepo and fakeListMemberRepo are hand-rolled in-memory
// doubles, same rationale as fakeEventRepo in event-ingestor_test.go: this
// backend has no mocking library, and these tests care about the service's
// own orchestration logic, not persistence.
type fakeListInviteRepo struct {
	mu      sync.Mutex
	invites map[uuid.UUID]*entities.ListInvite
}

func newFakeListInviteRepo() *fakeListInviteRepo {
	return &fakeListInviteRepo{invites: make(map[uuid.UUID]*entities.ListInvite)}
}

func (f *fakeListInviteRepo) Create(ctx context.Context, invite *entities.ListInvite) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	stored := *invite
	f.invites[invite.ID] = &stored
	return nil
}

func (f *fakeListInviteRepo) FindByID(ctx context.Context, id uuid.UUID) (*entities.ListInvite, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	invite, ok := f.invites[id]
	if !ok {
		return nil, nil
	}
	stored := *invite
	return &stored, nil
}

func (f *fakeListInviteRepo) FindByTokenHash(ctx context.Context, tokenHash string) (*entities.ListInvite, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, invite := range f.invites {
		if invite.TokenHash == tokenHash {
			stored := *invite
			return &stored, nil
		}
	}
	return nil, nil
}

func (f *fakeListInviteRepo) FindActiveByList(ctx context.Context, listID uuid.UUID, now time.Time) ([]*entities.ListInvite, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var result []*entities.ListInvite
	for _, invite := range f.invites {
		if invite.ListID == listID && invite.IsActive(now) {
			stored := *invite
			result = append(result, &stored)
		}
	}
	return result, nil
}

func (f *fakeListInviteRepo) Revoke(ctx context.Context, id uuid.UUID, revokedAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	invite, ok := f.invites[id]
	if !ok {
		return nil
	}
	invite.Revoke(revokedAt)
	return nil
}

type memberKey struct {
	listID uuid.UUID
	userID string
}

type fakeListMemberRepo struct {
	mu      sync.Mutex
	members map[memberKey]*entities.ListMember
}

func newFakeListMemberRepo() *fakeListMemberRepo {
	return &fakeListMemberRepo{members: make(map[memberKey]*entities.ListMember)}
}

func (f *fakeListMemberRepo) ClaimOwnershipIfUnowned(ctx context.Context, listID uuid.UUID, userID string, now time.Time) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for key := range f.members {
		if key.listID == listID {
			return false, nil
		}
	}
	member, err := entities.NewListMember(listID, userID, entities.RoleOwner, now, nil)
	if err != nil {
		return false, err
	}
	f.members[memberKey{listID, userID}] = member
	return true, nil
}

func (f *fakeListMemberRepo) Add(ctx context.Context, member *entities.ListMember) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := memberKey{member.ListID, member.UserID}
	if _, exists := f.members[key]; exists {
		return nil
	}
	stored := *member
	f.members[key] = &stored
	return nil
}

func (f *fakeListMemberRepo) FindByListAndUser(ctx context.Context, listID uuid.UUID, userID string) (*entities.ListMember, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	member, ok := f.members[memberKey{listID, userID}]
	if !ok {
		return nil, nil
	}
	stored := *member
	return &stored, nil
}

// fakeToDoListRepo implements repositories.ToDoListRepository, but this
// suite only ever exercises FindById - every other method panics so an
// accidental call surfaces immediately instead of silently no-oping.
type fakeToDoListRepo struct {
	lists map[uuid.UUID]*entities.ToDoList
}

func newFakeToDoListRepo(lists ...*entities.ToDoList) *fakeToDoListRepo {
	m := make(map[uuid.UUID]*entities.ToDoList, len(lists))
	for _, l := range lists {
		m[l.Id] = l
	}
	return &fakeToDoListRepo{lists: m}
}

func (f *fakeToDoListRepo) Create(context.Context, *entities.ValidatedToDoList, int64) error {
	panic("not used by ListSharingService tests")
}

func (f *fakeToDoListRepo) FindById(_ context.Context, id uuid.UUID) (*entities.ToDoList, error) {
	return f.lists[id], nil
}

func (f *fakeToDoListRepo) Update(context.Context, *entities.ValidatedToDoList, int64) error {
	panic("not used by ListSharingService tests")
}

func (f *fakeToDoListRepo) Delete(context.Context, uuid.UUID, time.Time, int64) error {
	panic("not used by ListSharingService tests")
}

func newSharingTestService(list *entities.ToDoList) (*ListSharingService, *fakeListInviteRepo, *fakeListMemberRepo) {
	invites := newFakeListInviteRepo()
	members := newFakeListMemberRepo()
	todoLists := newFakeToDoListRepo(list)
	svc := NewListSharingService(testLogger(), invites, members, todoLists).(*ListSharingService)
	return svc, invites, members
}

func testList() *entities.ToDoList {
	return &entities.ToDoList{Id: uuid.New(), Name: "Rewe"}
}

// --- CreateInvite ---

func TestListSharingService_CreateInvite_FirstInviterBecomesOwner(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "24h"})
	require.NoError(t, err)
	assert.NotEmpty(t, result.Token)

	member, err := members.FindByListAndUser(context.Background(), list.Id, "alice")
	require.NoError(t, err)
	require.NotNil(t, member)
	assert.Equal(t, entities.RoleOwner, member.Role)
}

func TestListSharingService_CreateInvite_NonMemberOfAlreadyClaimedListIsRejected(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "24h"})
	require.NoError(t, err)

	_, err = svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "mallory", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)
}

func TestListSharingService_CreateInvite_MemberMayNotInviteOthers(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "24h"})
	require.NoError(t, err)
	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	// bob joined as a plain member, not the owner - sharing is owner-only.
	_, err = svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "bob", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrNotListOwner)
}

func TestListSharingService_CreateInvite_UnknownListReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testList())

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: uuid.New(), UserID: "alice", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrListNotFound)
}

func TestListSharingService_CreateInvite_InvalidTTLIsRejected(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "3 weeks"})
	assert.ErrorIs(t, err, interfaces.ErrInvalidInviteTTL)
}

func TestListSharingService_CreateInvite_ExpiresAtMatchesPresetDuration(t *testing.T) {
	list := testList()
	svc, invites, _ := newSharingTestService(list)

	before := time.Now().UTC()
	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	after := time.Now().UTC()

	stored, err := invites.FindByID(context.Background(), result.Result.ID)
	require.NoError(t, err)
	assert.True(t, !stored.ExpiresAt.Before(before.Add(time.Hour)))
	assert.True(t, !stored.ExpiresAt.After(after.Add(time.Hour)))
}

func TestListSharingService_CreateInvite_OnlyTheTokenHashIsPersisted(t *testing.T) {
	list := testList()
	svc, invites, _ := newSharingTestService(list)

	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	stored, err := invites.FindByID(context.Background(), result.Result.ID)
	require.NoError(t, err)
	assert.NotEqual(t, result.Token, stored.TokenHash)
	assert.Equal(t, entities.HashInviteToken(result.Token), stored.TokenHash)
}

func TestListSharingService_CreateInvite_TwoCallsProduceDifferentTokens(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	first, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	second, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	assert.NotEqual(t, first.Token, second.Token)
}

// --- FindActiveInvites ---

func TestListSharingService_FindActiveInvites_ExcludesExpiredAndRevoked(t *testing.T) {
	list := testList()
	svc, invites, _ := newSharingTestService(list)

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	toRevoke, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	require.NoError(t, invites.Revoke(context.Background(), toRevoke.Result.ID, time.Now().UTC()))

	// An invite that's already expired.
	expired, _, err := entities.NewListInvite(list.Id, "alice", mustTTL(t, "1h"), time.Now().UTC().Add(-2*time.Hour))
	require.NoError(t, err)
	require.NoError(t, invites.Create(context.Background(), expired))

	result, err := svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: list.Id, UserID: "alice"})
	require.NoError(t, err)
	require.Len(t, result.Result, 1)
}

func TestListSharingService_FindActiveInvites_DoesNotClaimOwnershipOfAnUnownedList(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	// Nobody has ever created an invite for this list - it has zero
	// members. Merely asking to list its invites must not make the caller
	// its owner; only CreateInvite may claim ownership.
	_, err := svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: list.Id, UserID: "alice"})
	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)

	member, err := members.FindByListAndUser(context.Background(), list.Id, "alice")
	require.NoError(t, err)
	assert.Nil(t, member)
}

func TestListSharingService_FindActiveInvites_MemberMayNotList(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	// bob is a member, not the owner - listing invites is owner-only.
	_, err = svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: list.Id, UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrNotListOwner)
}

func mustTTL(t *testing.T, key string) entities.InviteTTL {
	t.Helper()
	ttl, err := entities.ParseInviteTTL(key)
	require.NoError(t, err)
	return ttl
}

// --- RevokeInvite ---

func TestListSharingService_RevokeInvite_CreatorMayRevoke(t *testing.T) {
	list := testList()
	svc, invites, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	stored, err := invites.FindByID(context.Background(), created.Result.ID)
	require.NoError(t, err)
	assert.NotNil(t, stored.RevokedAt)
}

// There used to be a test here for "the owner may revoke an invite someone
// else created" - that scenario no longer exists now that CreateInvite is
// itself owner-only (see TestListSharingService_CreateInvite_MemberMayNotInviteOthers):
// the creator of any invite is always the owner, so RevokeInvite's
// "creator OR owner" branch collapsed to "owner" (see the service).

func TestListSharingService_RevokeInvite_UnrelatedMemberMayNotRevoke(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	member, err := entities.NewListMember(list.Id, "bob", entities.RoleMember, time.Now().UTC(), nil)
	require.NoError(t, err)
	require.NoError(t, members.Add(context.Background(), member))

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotRevocable)
}

func TestListSharingService_RevokeInvite_UnknownInviteReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testList())

	_, err := svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: uuid.New(), UserID: "alice"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotFound)
}

func TestListSharingService_RevokeInvite_RevokingTwiceIsIdempotent(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)
	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	assert.NoError(t, err)
}

// --- RedeemInvite ---

func TestListSharingService_RedeemInvite_ValidTokenGrantsMembership(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	result, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.Equal(t, list.Id, result.ListID)
	assert.Equal(t, list.Name, result.ListName)
	assert.Equal(t, entities.RoleMember, result.Role)
	assert.False(t, result.AlreadyMember)

	member, err := members.FindByListAndUser(context.Background(), list.Id, "bob")
	require.NoError(t, err)
	require.NotNil(t, member)
	require.NotNil(t, member.InviteID)
	assert.Equal(t, created.Result.ID, *member.InviteID)
}

func TestListSharingService_RedeemInvite_ExpiredTokenIsRejected(t *testing.T) {
	list := testList()
	svc, invites, _ := newSharingTestService(list)

	expired, token, err := entities.NewListInvite(list.Id, "alice", mustTTL(t, "1h"), time.Now().UTC().Add(-2*time.Hour))
	require.NoError(t, err)
	require.NoError(t, invites.Create(context.Background(), expired))

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: string(token), UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteExpired)
}

func TestListSharingService_RedeemInvite_RevokedTokenIsRejected(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteRevoked)
}

func TestListSharingService_RedeemInvite_UnknownTokenReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testList())

	_, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: "does-not-exist", UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotFound)
}

func TestListSharingService_RedeemInvite_RedeemingTwiceIsIdempotentAndDoesNotDuplicateMembership(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	first, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.False(t, first.AlreadyMember)

	second, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.True(t, second.AlreadyMember)

	count := 0
	for key := range members.members {
		if key.listID == list.Id && key.userID == "bob" {
			count++
		}
	}
	assert.Equal(t, 1, count)
}

func TestListSharingService_RedeemInvite_RetryAfterRevokeStillSucceedsForAnExistingMember(t *testing.T) {
	list := testList()
	svc, _, _ := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	first, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.False(t, first.AlreadyMember)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	// Bob's client retries the same redeem call (e.g. a lost response) -
	// this must succeed as a no-op, not fail with ErrInviteRevoked, since
	// he already has the membership the token once granted.
	retry, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.True(t, retry.AlreadyMember)
	assert.Equal(t, entities.RoleMember, retry.Role)
}

func TestListSharingService_RedeemInvite_RevokingAnInviteDoesNotRemoveExistingMembers(t *testing.T) {
	list := testList()
	svc, _, members := newSharingTestService(list)

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: list.Id, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	member, err := members.FindByListAndUser(context.Background(), list.Id, "bob")
	require.NoError(t, err)
	assert.NotNil(t, member)
}
