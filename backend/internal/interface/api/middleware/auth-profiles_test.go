package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestKeycloakAuth_PersistsOnlyVerifiedGivenName(t *testing.T) {
	db := testhelpers.SetupTestDB(t)
	defer db.Conn.Close(context.Background())
	p := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, p.issuer())
	t.Setenv(envKeycloakClientID, testClientID)
	mw, err := NewKeycloakAuthWithProfiles(context.Background(), testLogger(), postgres.NewSqlcUserProfileRepository(db.Queries))
	require.NoError(t, err)
	e := echo.New()
	e.GET("/test", func(c echo.Context) error { return c.NoContent(http.StatusOK) }, mw)
	for _, tc := range []struct {
		name      string
		overrides map[string]any
		status    int
		stored    string
	}{
		{"given name only", map[string]any{"given_name": "Jean Luc", "name": "Jean Luc Secret", "family_name": "Secret", "email": "private@example.com"}, 200, "Jean Luc"},
		{"wrong client cannot overwrite", map[string]any{"azp": "other", "given_name": "Forged"}, 401, "Jean Luc"},
		{"missing subject", map[string]any{"sub": "", "given_name": "Forged"}, 401, "Jean Luc"},
		{"no fallback to full name", map[string]any{"name": "Anna Secret"}, 200, ""},
		{"name refresh", map[string]any{"given_name": "Anne"}, 200, "Anne"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := p.signToken(t, defaultClaims(p.issuer(), tc.overrides))
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
			var name string
			require.NoError(t, db.Conn.QueryRow(context.Background(), "SELECT first_name FROM user_profiles WHERE user_id = 'user-123'").Scan(&name))
			require.Equal(t, tc.stored, name)
		})
	}
	// Invalid signatures must not create profiles either.
	other := newTestOIDCProvider(t)
	token := other.signToken(t, defaultClaims(p.issuer(), map[string]any{"sub": "attacker", "given_name": "Forged"}))
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	var count int
	require.NoError(t, db.Conn.QueryRow(context.Background(), "SELECT count(*) FROM user_profiles").Scan(&count))
	require.Equal(t, 1, count)
}
