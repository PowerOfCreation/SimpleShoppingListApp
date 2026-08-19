package services

import (
	"context"
	"log/slog"
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

// testLogger is shared by every *_test.go file in this package.
func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

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

func (f *fakeListMemberRepo) FindAccessibleListIDs(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var accessible []uuid.UUID
	for _, listID := range listIDs {
		if _, ok := f.members[memberKey{listID, userID}]; ok {
			accessible = append(accessible, listID)
		}
	}
	return accessible, nil
}

func (f *fakeListMemberRepo) FindClaimedListIDs(ctx context.Context, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	requested := make(map[uuid.UUID]struct{}, len(listIDs))
	for _, listID := range listIDs {
		requested[listID] = struct{}{}
	}
	seen := make(map[uuid.UUID]struct{})
	var claimed []uuid.UUID
	for key := range f.members {
		if _, ok := requested[key.listID]; !ok {
			continue
		}
		if _, ok := seen[key.listID]; ok {
			continue
		}
		seen[key.listID] = struct{}{}
		claimed = append(claimed, key.listID)
	}
	return claimed, nil
}

// fakeSyncedListRepo is the registry: a set of list ids the server holds a
// log for. No content, mirroring the real table.
type fakeSyncedListRepo struct {
	ids map[uuid.UUID]struct{}
}

func newFakeSyncedListRepo(ids ...uuid.UUID) *fakeSyncedListRepo {
	m := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		m[id] = struct{}{}
	}
	return &fakeSyncedListRepo{ids: m}
}

func (f *fakeSyncedListRepo) Exists(_ context.Context, id uuid.UUID) (bool, error) {
	_, ok := f.ids[id]
	return ok, nil
}

func newSharingTestService(listID uuid.UUID) (*ListSharingService, *fakeListInviteRepo, *fakeListMemberRepo) {
	invites := newFakeListInviteRepo()
	members := newFakeListMemberRepo()
	lists := newFakeSyncedListRepo(listID)
	access := NewListAccessService(members)
	svc := NewListSharingService(testLogger(), invites, members, lists, access).(*ListSharingService)
	return svc, invites, members
}

func testListID() uuid.UUID {
	return uuid.New()
}

// seedOwner simulates what the push path (ListAccessService.AuthorizeWrite,
// called from EventController on the first push of a new list) does before
// any of these tests run - ownership is no longer something ListSharingService
// itself grants.
func seedOwner(t *testing.T, members *fakeListMemberRepo, listID uuid.UUID, userID string) {
	t.Helper()
	claimed, err := members.ClaimOwnershipIfUnowned(context.Background(), listID, userID, time.Now().UTC())
	require.NoError(t, err)
	require.True(t, claimed)
}

// --- CreateInvite ---

func TestListSharingService_CreateInvite_NonMemberOfUnclaimedListIsRejected(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)

	// Nobody has pushed to this list yet - ListSharingService itself never
	// claims ownership anymore (see ListAccessService.AuthorizeWrite, the
	// push path's job), so a bare CreateInvite call must not grant it.
	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)

	member, err := members.FindByListAndUser(context.Background(), listID, "alice")
	require.NoError(t, err)
	assert.Nil(t, member)
}

func TestListSharingService_CreateInvite_OwnerMayInvite(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "24h"})
	require.NoError(t, err)
	assert.NotEmpty(t, result.Token)
}

func TestListSharingService_CreateInvite_NonMemberOfAlreadyClaimedListIsRejected(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "mallory", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)
}

func TestListSharingService_CreateInvite_MemberMayNotInviteOthers(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "24h"})
	require.NoError(t, err)
	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	// bob joined as a plain member, not the owner - sharing is owner-only.
	_, err = svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "bob", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrNotListOwner)
}

func TestListSharingService_CreateInvite_UnknownListReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testListID())

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: uuid.New(), UserID: "alice", TTLKey: "24h"})
	assert.ErrorIs(t, err, interfaces.ErrListNotFound)
}

func TestListSharingService_CreateInvite_InvalidTTLIsRejected(t *testing.T) {
	listID := testListID()
	svc, _, _ := newSharingTestService(listID)

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "3 weeks"})
	assert.ErrorIs(t, err, interfaces.ErrInvalidInviteTTL)
}

func TestListSharingService_CreateInvite_ExpiresAtMatchesPresetDuration(t *testing.T) {
	listID := testListID()
	svc, invites, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	before := time.Now().UTC()
	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	after := time.Now().UTC()

	stored, err := invites.FindByID(context.Background(), result.Result.ID)
	require.NoError(t, err)
	assert.True(t, !stored.ExpiresAt.Before(before.Add(time.Hour)))
	assert.True(t, !stored.ExpiresAt.After(after.Add(time.Hour)))
}

func TestListSharingService_CreateInvite_OnlyTheTokenHashIsPersisted(t *testing.T) {
	listID := testListID()
	svc, invites, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	result, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	stored, err := invites.FindByID(context.Background(), result.Result.ID)
	require.NoError(t, err)
	assert.NotEqual(t, result.Token, stored.TokenHash)
	assert.Equal(t, entities.HashInviteToken(result.Token), stored.TokenHash)
}

func TestListSharingService_CreateInvite_TwoCallsProduceDifferentTokens(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	first, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	second, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	assert.NotEqual(t, first.Token, second.Token)
}

// --- FindActiveInvites ---

func TestListSharingService_FindActiveInvites_ExcludesExpiredAndRevoked(t *testing.T) {
	listID := testListID()
	svc, invites, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	_, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	toRevoke, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	require.NoError(t, invites.Revoke(context.Background(), toRevoke.Result.ID, time.Now().UTC()))

	// An invite that's already expired.
	expired, _, err := entities.NewListInvite(listID, "alice", mustTTL(t, "1h"), time.Now().UTC().Add(-2*time.Hour))
	require.NoError(t, err)
	require.NoError(t, invites.Create(context.Background(), expired))

	result, err := svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: listID, UserID: "alice"})
	require.NoError(t, err)
	require.Len(t, result.Result, 1)
}

func TestListSharingService_FindActiveInvites_DoesNotClaimOwnershipOfAnUnownedList(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)

	// Nobody has ever pushed to this list - it has zero members. Merely
	// asking to list its invites must not make the caller its owner; only
	// the push path (ListAccessService.AuthorizeWrite) may claim ownership.
	_, err := svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: listID, UserID: "alice"})
	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)

	member, err := members.FindByListAndUser(context.Background(), listID, "alice")
	require.NoError(t, err)
	assert.Nil(t, member)
}

func TestListSharingService_FindActiveInvites_MemberMayNotList(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	// bob is a member, not the owner - listing invites is owner-only.
	_, err = svc.FindActiveInvites(context.Background(), &query.GetListInvitesQuery{ListID: listID, UserID: "bob"})
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
	listID := testListID()
	svc, invites, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
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
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	member, err := entities.NewListMember(listID, "bob", entities.RoleMember, time.Now().UTC(), nil)
	require.NoError(t, err)
	require.NoError(t, members.Add(context.Background(), member))

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotRevocable)
}

func TestListSharingService_RevokeInvite_UnknownInviteReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testListID())

	_, err := svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: uuid.New(), UserID: "alice"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotFound)
}

func TestListSharingService_RevokeInvite_RevokingTwiceIsIdempotent(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)
	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	assert.NoError(t, err)
}

// --- RedeemInvite ---

func TestListSharingService_RedeemInvite_ValidTokenGrantsMembership(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	result, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.Equal(t, listID, result.ListID)
	assert.Equal(t, entities.RoleMember, result.Role)
	assert.False(t, result.AlreadyMember)

	member, err := members.FindByListAndUser(context.Background(), listID, "bob")
	require.NoError(t, err)
	require.NotNil(t, member)
	require.NotNil(t, member.InviteID)
	assert.Equal(t, created.Result.ID, *member.InviteID)
}

func TestListSharingService_RedeemInvite_ExpiredTokenIsRejected(t *testing.T) {
	listID := testListID()
	svc, invites, _ := newSharingTestService(listID)

	expired, token, err := entities.NewListInvite(listID, "alice", mustTTL(t, "1h"), time.Now().UTC().Add(-2*time.Hour))
	require.NoError(t, err)
	require.NoError(t, invites.Create(context.Background(), expired))

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: string(token), UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteExpired)
}

func TestListSharingService_RedeemInvite_RevokedTokenIsRejected(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)
	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteRevoked)
}

func TestListSharingService_RedeemInvite_UnknownTokenReturnsNotFound(t *testing.T) {
	svc, _, _ := newSharingTestService(testListID())

	_, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: "does-not-exist", UserID: "bob"})
	assert.ErrorIs(t, err, interfaces.ErrInviteNotFound)
}

func TestListSharingService_RedeemInvite_RedeemingTwiceIsIdempotentAndDoesNotDuplicateMembership(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	first, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.False(t, first.AlreadyMember)

	second, err := svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)
	assert.True(t, second.AlreadyMember)

	count := 0
	for key := range members.members {
		if key.listID == listID && key.userID == "bob" {
			count++
		}
	}
	assert.Equal(t, 1, count)
}

func TestListSharingService_RedeemInvite_RetryAfterRevokeStillSucceedsForAnExistingMember(t *testing.T) {
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
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
	listID := testListID()
	svc, _, members := newSharingTestService(listID)
	seedOwner(t, members, listID, "alice")

	created, err := svc.CreateInvite(context.Background(), &command.CreateListInviteCommand{ListID: listID, UserID: "alice", TTLKey: "1h"})
	require.NoError(t, err)

	_, err = svc.RedeemInvite(context.Background(), &command.RedeemListInviteCommand{Token: created.Token, UserID: "bob"})
	require.NoError(t, err)

	_, err = svc.RevokeInvite(context.Background(), &command.RevokeListInviteCommand{InviteID: created.Result.ID, UserID: "alice"})
	require.NoError(t, err)

	member, err := members.FindByListAndUser(context.Background(), listID, "bob")
	require.NoError(t, err)
	assert.NotNil(t, member)
}
