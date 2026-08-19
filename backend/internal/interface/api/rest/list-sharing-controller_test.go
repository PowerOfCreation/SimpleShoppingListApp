package rest

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/query"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
)

// withUserID is a test-only auth stand-in: middleware.Passthrough sets no
// identity at all, but every handler here needs one to exercise its
// authorized path - a small middleware that stashes it the same way
// middleware.NewKeycloakAuth does.
func withUserID(userID string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set("user_id", userID)
			return next(c)
		}
	}
}

// stubListSharingService implements interfaces.ListSharingService with one
// overridable function field per method exercised by a given test; any
// other method panics so an unexpected call fails loudly instead of
// returning a misleading zero value.
type stubListSharingService struct {
	createInvite func(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error)
	findInvites  func(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error)
	revokeInvite func(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error)
	redeemInvite func(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error)
}

func (s *stubListSharingService) CreateInvite(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error) {
	if s.createInvite == nil {
		panic("CreateInvite not used by this test")
	}
	return s.createInvite(ctx, cmd)
}

func (s *stubListSharingService) FindActiveInvites(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error) {
	if s.findInvites == nil {
		panic("FindActiveInvites not used by this test")
	}
	return s.findInvites(ctx, qry)
}

func (s *stubListSharingService) RevokeInvite(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error) {
	if s.revokeInvite == nil {
		panic("RevokeInvite not used by this test")
	}
	return s.revokeInvite(ctx, cmd)
}

func (s *stubListSharingService) RedeemInvite(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error) {
	if s.redeemInvite == nil {
		panic("RedeemInvite not used by this test")
	}
	return s.redeemInvite(ctx, cmd)
}

func TestListSharingController_CreateInvite_ReturnsTokenAndUsesContextUserID(t *testing.T) {
	listID := uuid.New()
	inviteID := uuid.New()
	now := time.Now().UTC()

	service := &stubListSharingService{
		createInvite: func(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error) {
			assert.Equal(t, listID, cmd.ListID)
			assert.Equal(t, "user-1", cmd.UserID)
			assert.Equal(t, "7d", cmd.TTLKey)
			return &command.CreateListInviteCommandResult{
				Result: &common.ListInviteResult{
					ID: inviteID, ListID: listID, CreatedBy: "user-1",
					CreatedAt: now, ExpiresAt: now.Add(7 * 24 * time.Hour),
				},
				Token: "plaintext-token",
			}, nil
		},
	}

	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/todo-lists/"+listID.String()+"/invites", strings.NewReader(`{"ttl":"7d"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Contains(t, rec.Body.String(), `"token":"plaintext-token"`)
	assert.Contains(t, rec.Body.String(), inviteID.String())
}

func TestListSharingController_CreateInvite_MissingUserIDReturns401(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/todo-lists/"+uuid.New().String()+"/invites", strings.NewReader(`{"ttl":"7d"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestListSharingController_CreateInvite_InvalidListIDReturns400(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/todo-lists/not-a-uuid/invites", strings.NewReader(`{"ttl":"7d"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_CreateInvite_MalformedBodyReturns400(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/todo-lists/"+uuid.New().String()+"/invites", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_CreateInvite_ErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"list not found", interfaces.ErrListNotFound, http.StatusNotFound},
		{"not a member", interfaces.ErrNotAListMember, http.StatusForbidden},
		{"member but not owner", interfaces.ErrNotListOwner, http.StatusForbidden},
		{"invalid ttl wrapped with the offending key", fmt.Errorf("%w: bogus", interfaces.ErrInvalidInviteTTL), http.StatusBadRequest},
		{"error text resembling ttl message but not the sentinel", errors.New("invalid invite ttl: bogus"), http.StatusInternalServerError},
		{"unexpected", errors.New("boom"), http.StatusInternalServerError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := &stubListSharingService{
				createInvite: func(ctx context.Context, cmd *command.CreateListInviteCommand) (*command.CreateListInviteCommandResult, error) {
					return nil, tc.err
				},
			}
			e := echo.New()
			NewListSharingController(e, testLogger(), service, withUserID("user-1"))

			req := httptest.NewRequest(http.MethodPost, "/api/v1/todo-lists/"+uuid.New().String()+"/invites", strings.NewReader(`{"ttl":"7d"}`))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()

			e.ServeHTTP(rec, req)

			assert.Equal(t, tc.wantStatus, rec.Code)
		})
	}
}

func TestListSharingController_GetInvites_ReturnsEmptyListAsArrayNeverAToken(t *testing.T) {
	listID := uuid.New()
	service := &stubListSharingService{
		findInvites: func(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error) {
			assert.Equal(t, listID, qry.ListID)
			assert.Equal(t, "user-1", qry.UserID)
			return &query.GetListInvitesQueryResult{Result: nil}, nil
		},
	}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/todo-lists/"+listID.String()+"/invites", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"invites":[]}`, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "token")
}

func TestListSharingController_GetInvites_ContainsMetadataButNoToken(t *testing.T) {
	listID := uuid.New()
	inviteID := uuid.New()
	now := time.Now().UTC()
	service := &stubListSharingService{
		findInvites: func(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error) {
			return &query.GetListInvitesQueryResult{Result: []*common.ListInviteResult{
				{ID: inviteID, ListID: listID, CreatedBy: "user-1", CreatedAt: now, ExpiresAt: now.Add(time.Hour)},
			}}, nil
		},
	}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/todo-lists/"+listID.String()+"/invites", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), inviteID.String())
	assert.NotContains(t, rec.Body.String(), `"token"`)
}

func TestListSharingController_GetInvites_MissingUserIDReturns401(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/todo-lists/"+uuid.New().String()+"/invites", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestListSharingController_GetInvites_ForbiddenAndNotFoundMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"not a member", interfaces.ErrNotAListMember, http.StatusForbidden},
		{"member but not owner", interfaces.ErrNotListOwner, http.StatusForbidden},
		{"list not found", interfaces.ErrListNotFound, http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := &stubListSharingService{
				findInvites: func(ctx context.Context, qry *query.GetListInvitesQuery) (*query.GetListInvitesQueryResult, error) {
					return nil, tc.err
				},
			}
			e := echo.New()
			NewListSharingController(e, testLogger(), service, withUserID("user-1"))

			req := httptest.NewRequest(http.MethodGet, "/api/v1/todo-lists/"+uuid.New().String()+"/invites", nil)
			rec := httptest.NewRecorder()

			e.ServeHTTP(rec, req)

			assert.Equal(t, tc.wantStatus, rec.Code)
		})
	}
}

func TestListSharingController_RevokeInvite_ReturnsNoContent(t *testing.T) {
	inviteID := uuid.New()
	service := &stubListSharingService{
		revokeInvite: func(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error) {
			assert.Equal(t, inviteID, cmd.InviteID)
			assert.Equal(t, "user-1", cmd.UserID)
			return &command.RevokeListInviteCommandResult{}, nil
		},
	}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/invites/"+inviteID.String(), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Body.String())
}

func TestListSharingController_RevokeInvite_MissingUserIDReturns401(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/invites/"+uuid.New().String(), nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestListSharingController_RevokeInvite_InvalidInviteIDReturns400(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/invites/not-a-uuid", nil)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_RevokeInvite_ErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"invite not found", interfaces.ErrInviteNotFound, http.StatusNotFound},
		{"not revocable", interfaces.ErrInviteNotRevocable, http.StatusForbidden},
		{"unexpected", errors.New("boom"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := &stubListSharingService{
				revokeInvite: func(ctx context.Context, cmd *command.RevokeListInviteCommand) (*command.RevokeListInviteCommandResult, error) {
					return nil, tc.err
				},
			}
			e := echo.New()
			NewListSharingController(e, testLogger(), service, withUserID("user-1"))

			req := httptest.NewRequest(http.MethodDelete, "/api/v1/invites/"+uuid.New().String(), nil)
			rec := httptest.NewRecorder()

			e.ServeHTTP(rec, req)

			assert.Equal(t, tc.wantStatus, rec.Code)
		})
	}
}

func TestListSharingController_RedeemInvite_ReturnsAlreadyMemberFlag(t *testing.T) {
	listID := uuid.New()
	service := &stubListSharingService{
		redeemInvite: func(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error) {
			assert.Equal(t, "raw-token", cmd.Token)
			assert.Equal(t, "user-2", cmd.UserID)
			return &command.RedeemListInviteCommandResult{
				ListID: listID, Role: entities.RoleMember, AlreadyMember: true,
			}, nil
		},
	}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-2"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{"token":"raw-token"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t,
		`{"list_id":"`+listID.String()+`","role":"member","already_member":true}`,
		rec.Body.String(),
	)
}

func TestListSharingController_RedeemInvite_MissingUserIDReturns401(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, middleware.Passthrough)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{"token":"raw-token"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestListSharingController_RedeemInvite_EmptyTokenReturns400WithoutCallingService(t *testing.T) {
	// An empty token must not reach the service - hashing "" and looking it
	// up would surface as ErrInviteNotFound (404), conflating a missing
	// request field with a genuinely unknown invite.
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{"token":""}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_RedeemInvite_MissingTokenFieldReturns400(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_RedeemInvite_MalformedBodyReturns400(t *testing.T) {
	service := &stubListSharingService{}
	e := echo.New()
	NewListSharingController(e, testLogger(), service, withUserID("user-1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{not valid`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestListSharingController_RedeemInvite_ErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"invite not found", interfaces.ErrInviteNotFound, http.StatusNotFound},
		{"expired", interfaces.ErrInviteExpired, http.StatusGone},
		{"revoked", interfaces.ErrInviteRevoked, http.StatusGone},
		{"unexpected", errors.New("boom"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := &stubListSharingService{
				redeemInvite: func(ctx context.Context, cmd *command.RedeemListInviteCommand) (*command.RedeemListInviteCommandResult, error) {
					return nil, tc.err
				},
			}
			e := echo.New()
			NewListSharingController(e, testLogger(), service, withUserID("user-1"))

			req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(`{"token":"t"}`))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()

			e.ServeHTTP(rec, req)

			assert.Equal(t, tc.wantStatus, rec.Code)
		})
	}
}
