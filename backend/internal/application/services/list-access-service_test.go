package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

// newAccessTestService reuses fakeListMemberRepo from
// list-sharing-service_test.go - same in-memory double, no DB needed for
// ListAccessService's own orchestration logic (the atomicity of the
// underlying claim is a repository-level guarantee, covered by
// sqlc_list-member-repository_test.go).
func newAccessTestService() (*ListAccessService, *fakeListMemberRepo) {
	members := newFakeListMemberRepo()
	return NewListAccessService(members).(*ListAccessService), members
}

func TestListAccessService_AuthorizeWrite_FirstPushClaimsOwnership(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()

	err := access.AuthorizeWrite(context.Background(), "alice", []uuid.UUID{listID})

	require.NoError(t, err)
	member, err := members.FindByListAndUser(context.Background(), listID, "alice")
	require.NoError(t, err)
	require.NotNil(t, member)
	assert.Equal(t, entities.RoleOwner, member.Role)
}

func TestListAccessService_AuthorizeWrite_ExistingMemberIsAuthorized(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")
	member, err := entities.NewListMember(listID, "bob", entities.RoleMember, time.Now().UTC(), nil)
	require.NoError(t, err)
	require.NoError(t, members.Add(context.Background(), member))

	err = access.AuthorizeWrite(context.Background(), "bob", []uuid.UUID{listID})

	assert.NoError(t, err)
}

func TestListAccessService_AuthorizeWrite_NonMemberOfAClaimedListIsDenied(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")

	err := access.AuthorizeWrite(context.Background(), "mallory", []uuid.UUID{listID})

	assert.ErrorIs(t, err, interfaces.ErrListAccessDenied)
}

// TestListAccessService_AuthorizeWrite_RejectsTheWholeBatchOnFirstDeniedList
// guards the batch semantics EventController relies on: a push covering
// several lists must not authorize (and enqueue) some of them just because
// they happened to come before the rejected one.
func TestListAccessService_AuthorizeWrite_RejectsTheWholeBatchOnFirstDeniedList(t *testing.T) {
	access, members := newAccessTestService()
	ownList := uuid.New()
	foreignList := uuid.New()
	seedOwner(t, members, ownList, "alice")
	seedOwner(t, members, foreignList, "mallory")

	err := access.AuthorizeWrite(context.Background(), "alice", []uuid.UUID{ownList, foreignList})

	assert.ErrorIs(t, err, interfaces.ErrListAccessDenied)
}

func TestListAccessService_FilterAccessible_OmitsListsTheCallerIsNotAMemberOf(t *testing.T) {
	access, members := newAccessTestService()
	own := uuid.New()
	foreign := uuid.New()
	seedOwner(t, members, own, "alice")
	seedOwner(t, members, foreign, "mallory")

	accessible, err := access.FilterAccessible(context.Background(), "alice", []uuid.UUID{own, foreign})

	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{own}, accessible)
}

func TestListAccessService_FilterAccessible_NeverClaims(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()

	accessible, err := access.FilterAccessible(context.Background(), "alice", []uuid.UUID{listID})

	require.NoError(t, err)
	assert.Empty(t, accessible)
	member, err := members.FindByListAndUser(context.Background(), listID, "alice")
	require.NoError(t, err)
	assert.Nil(t, member, "a read must never grant access as a side effect")
}

func TestListAccessService_RequireRead_MemberIsAllowed(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")

	assert.NoError(t, access.RequireRead(context.Background(), "alice", listID))
}

func TestListAccessService_RequireRead_NonMemberIsDenied(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")

	err := access.RequireRead(context.Background(), "mallory", listID)

	assert.ErrorIs(t, err, interfaces.ErrListAccessDenied)
}

func TestListAccessService_RequireOwner_OwnerIsAllowed(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")

	assert.NoError(t, access.RequireOwner(context.Background(), "alice", listID))
}

func TestListAccessService_RequireOwner_PlainMemberIsDenied(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")
	member, err := entities.NewListMember(listID, "bob", entities.RoleMember, time.Now().UTC(), nil)
	require.NoError(t, err)
	require.NoError(t, members.Add(context.Background(), member))

	err = access.RequireOwner(context.Background(), "bob", listID)

	assert.ErrorIs(t, err, interfaces.ErrNotListOwner)
}

func TestListAccessService_RequireOwner_NonMemberIsDenied(t *testing.T) {
	access, members := newAccessTestService()
	listID := uuid.New()
	seedOwner(t, members, listID, "alice")

	err := access.RequireOwner(context.Background(), "mallory", listID)

	assert.ErrorIs(t, err, interfaces.ErrNotAListMember)
}
