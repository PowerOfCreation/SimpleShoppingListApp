package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/labstack/echo/v4"
)

const (
	envKeycloakIssuer   = "KEYCLOAK_ISSUER"
	envKeycloakClientID = "KEYCLOAK_CLIENT_ID"
)

// Passthrough lets every request through unauthenticated. Only for tests
// that need to exercise a handler without a real identity provider.
func Passthrough(next echo.HandlerFunc) echo.HandlerFunc {
	return next
}

// NewKeycloakAuth builds an Echo middleware that verifies a bearer token's
// signature (via JWKS), issuer, and expiry, rejecting otherwise with 401.
//
// Keycloak access tokens carry `aud: "account"` for every client, so the
// real client is checked via `azp` instead (SkipClientIDCheck: true).
//
// KEYCLOAK_ISSUER and KEYCLOAK_CLIENT_ID are required; if they're unset or
// the issuer is unreachable, this returns an error instead of falling back
// to no auth - callers should treat that as fatal.
//
// Does not scope data to a user yet (see sync-design-decisions.md): any
// valid token can still read/write any known list id.
func NewKeycloakAuth(ctx context.Context, logger *slog.Logger) (echo.MiddlewareFunc, error) {
	issuer := os.Getenv(envKeycloakIssuer)
	clientID := os.Getenv(envKeycloakClientID)

	if issuer == "" || clientID == "" {
		return nil, fmt.Errorf("%s and %s must both be set", envKeycloakIssuer, envKeycloakClientID)
	}

	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("fetching OIDC discovery document from %s: %w", issuer, err)
	}

	verifier := provider.Verifier(&oidc.Config{SkipClientIDCheck: true})
	logger.Info("auth configured", "issuer", issuer, "client_id", clientID)

	mw := func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token, ok := bearerToken(c.Request())
			if !ok {
				RequestScopedLogger(logger, c).Warn("rejected request", "reason", "missing bearer token")
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "missing bearer token",
				})
			}

			idToken, err := verifier.Verify(c.Request().Context(), token)
			if err != nil {
				RequestScopedLogger(logger, c).Warn("rejected request", "reason", "invalid token", "error", err)
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token",
				})
			}

			var claims struct {
				AuthorizedParty string `json:"azp"`
			}
			if err := idToken.Claims(&claims); err != nil {
				RequestScopedLogger(logger, c).Warn("rejected request", "reason", "failed to parse claims", "error", err)
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token",
				})
			}
			if claims.AuthorizedParty != clientID {
				RequestScopedLogger(logger, c).Warn("rejected request", "reason", "azp mismatch", "azp", claims.AuthorizedParty)
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token",
				})
			}

			// Stashed for future user-scoping (see sync-design-decisions.md);
			// no handler reads this yet.
			c.Set("user_id", idToken.Subject)

			return next(c)
		}
	}

	return mw, nil
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	return strings.TrimPrefix(header, prefix), true
}
