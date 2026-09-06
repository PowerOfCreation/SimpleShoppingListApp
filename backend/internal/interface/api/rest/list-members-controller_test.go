package rest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestListMembersController_AccessAndProfiles(t *testing.T) {
	db := testhelpers.SetupTestDB(t)
	defer db.Conn.Close(context.Background())
	ctx := context.Background()
	members := postgres.NewSqlcListMemberRepository(db.Queries)
	profiles := postgres.NewSqlcUserProfileRepository(db.Queries)
	listID := uuid.New()
	claimed, err := members.ClaimOwnershipIfUnowned(ctx, listID, "owner", time.Now())
	require.NoError(t, err)
	require.True(t, claimed)
	for _, id := range []string{"member", "legacy"} {
		m, err := entities.NewListMember(listID, id, entities.RoleMember, time.Now(), nil)
		require.NoError(t, err)
		require.NoError(t, members.Add(ctx, m))
	}
	for id, name := range map[string]string{"owner": "Anna", "member": "Jean Luc", "outsider": "Private"} {
		p, err := entities.NewUserProfile(id, name)
		require.NoError(t, err)
		require.NoError(t, profiles.Upsert(ctx, p))
	}
	service := services.NewListMembersService(profiles, services.NewListAccessService(members))
	for _, tc := range []struct {
		name, user, list string
		status           int
	}{
		{"owner", "owner", listID.String(), 200},
		{"member", "member", listID.String(), 200},
		{"outsider", "outsider", listID.String(), 403},
		{"unknown list", "owner", uuid.NewString(), 403},
		{"invalid id", "owner", "invalid", 400},
		{"anonymous", "", listID.String(), 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := echo.New()
			NewListMembersController(e, testLogger(), service, withUserID(tc.user))
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/todo-lists/"+tc.list+"/members", nil))
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
			if tc.status == 200 {
				require.JSONEq(t, `{"members":[{"user_id":"legacy","first_name":""},{"user_id":"member","first_name":"Jean Luc"},{"user_id":"owner","first_name":"Anna"}]}`, rec.Body.String())
				require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			} else {
				require.NotContains(t, rec.Body.String(), "Anna")
			}
		})
	}
	// Profiles can be refreshed and cleared without changing membership.
	for _, name := range []string{"Anne", ""} {
		p, err := entities.NewUserProfile("owner", name)
		require.NoError(t, err)
		require.NoError(t, profiles.Upsert(ctx, p))
		got, err := service.FindMembers(ctx, "member", listID)
		require.NoError(t, err)
		require.Len(t, got, 3)
		require.Equal(t, name, got[2].FirstName())
	}
}
