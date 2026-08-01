package middleware

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/labstack/echo/v4"
)

// Env vars configuring Keycloak token verification. Both must be set for
// the middleware to actually verify anything - see NewKeycloakAuth.
const (
	envKeycloakIssuer   = "KEYCLOAK_ISSUER"
	envKeycloakClientID = "KEYCLOAK_CLIENT_ID"
)

// Passthrough lets every request through unauthenticated. It's what
// NewKeycloakAuth falls back to when Keycloak isn't configured, and is
// also what tests pass explicitly so controller tests don't need a real
// (or fake) identity provider to exercise the handler underneath.
func Passthrough(next echo.HandlerFunc) echo.HandlerFunc {
	return next
}

// NewKeycloakAuth builds an Echo middleware that verifies a bearer token's
// signature (via the issuer's JWKS, fetched and cached by go-oidc),
// issuer, and expiry, rejecting the request with 401 otherwise.
//
// Keycloak access tokens carry `aud: "account"` for every client by
// default - the actual client is only identifiable via `azp` (authorized
// party) - so verification runs with SkipClientIDCheck: true and azp is
// checked by hand against the configured client id instead.
//
// If KEYCLOAK_ISSUER or KEYCLOAK_CLIENT_ID is unset (or the issuer's
// discovery document can't be fetched), this returns Passthrough and logs
// a loud warning once, rather than failing to start - this is what keeps
// local development and the test suite (neither of which run a Keycloak
// instance) working unmodified.
//
// This deliberately does not scope any data to a user yet (see
// sync-design-decisions.md): a valid token from any account is still
// allowed to read/write any known list id. It only closes the "the API is
// completely open" gap, not the "any user can read any other user's
// lists" one.
func NewKeycloakAuth(ctx context.Context) echo.MiddlewareFunc {
	issuer := os.Getenv(envKeycloakIssuer)
	clientID := os.Getenv(envKeycloakClientID)

	if issuer == "" || clientID == "" {
		log.Printf(
			"auth: %s/%s not set - sync endpoints are running WITHOUT authentication",
			envKeycloakIssuer, envKeycloakClientID,
		)
		return Passthrough
	}

	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		log.Printf(
			"auth: failed to fetch OIDC discovery document from %s: %v - sync endpoints are running WITHOUT authentication",
			issuer, err,
		)
		return Passthrough
	}

	verifier := provider.Verifier(&oidc.Config{SkipClientIDCheck: true})
	log.Printf("auth: verifying bearer tokens against issuer %s (client %s)", issuer, clientID)

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token, ok := bearerToken(c.Request())
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "missing bearer token",
				})
			}

			idToken, err := verifier.Verify(c.Request().Context(), token)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token",
				})
			}

			var claims struct {
				AuthorizedParty string `json:"azp"`
			}
			if err := idToken.Claims(&claims); err != nil || claims.AuthorizedParty != clientID {
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
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	return strings.TrimPrefix(header, prefix), true
}
