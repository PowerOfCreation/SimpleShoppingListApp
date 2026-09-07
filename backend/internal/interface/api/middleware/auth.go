package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

const (
	envKeycloakIssuer   = "KEYCLOAK_ISSUER"
	envKeycloakClientID = "KEYCLOAK_CLIENT_ID"

	userIDContextKey      = "user_id"
	userNameContextKey    = "user_name"
	userPictureContextKey = "user_picture"
)

// Passthrough lets every request through unauthenticated. Only for tests
// that need to exercise a handler without a real identity provider.
func Passthrough(next echo.HandlerFunc) echo.HandlerFunc {
	return next
}

// NewKeycloakAuth builds an Echo middleware that verifies a bearer token's
// signature (via JWKS), issuer, and expiry, rejecting otherwise with 401.
// When profiles is non-nil, it also refreshes given_name from verified
// tokens before handling requests (tests that don't care about profile
// refresh pass nil).
//
// Keycloak access tokens carry `aud: "account"` for every client, so the
// real client is checked via `azp` instead (SkipClientIDCheck: true).
//
// KEYCLOAK_ISSUER and KEYCLOAK_CLIENT_ID are required; if they're unset or
// the issuer is unreachable, this returns an error instead of falling back
// to no auth - callers should treat that as fatal.
//
// Verifying the token is only step one: it proves *who* the caller is, not
// *what* they may touch. List-level access (list_members) is enforced
// separately, by ListAccessService - see sync-sharing-target.md §2.
func NewKeycloakAuth(ctx context.Context, logger *slog.Logger, profiles repositories.UserProfileRepository) (echo.MiddlewareFunc, error) {
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
				// Name and Picture are optional OIDC profile claims (the
				// "profile" scope frontend/api/auth/config.ts requests) -
				// Keycloak doesn't always populate either, so both are read
				// best-effort and never gate authentication.
				GivenName string `json:"given_name"`
				Name      string `json:"name"`
				Picture   string `json:"picture"`
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

			profile, err := entities.NewUserProfile(idToken.Subject, claims.GivenName)
			if err != nil {
				RequestScopedLogger(logger, c).Warn("rejected request", "reason", "invalid subject", "error", err)
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token"})
			}
			// Best-effort from here: this middleware guards every
			// authenticated route (events, sync, sharing, WebSocket), so a
			// profile-store hiccup must not turn into a 500 for unrelated
			// requests - the refresh is retried on the caller's next request.
			if profiles != nil {
				if err := profiles.Upsert(c.Request().Context(), profile); err != nil {
					RequestScopedLogger(logger, c).Error("failed to update user profile", "error", err)
				}
			}

			// Stashed for user-scoping (see sync-design-decisions.md); read
			// via UserIDFromContext by handlers that need the caller's
			// identity (e.g. list-sharing-controller.go).
			c.Set(userIDContextKey, idToken.Subject)
			// Read via UserProfileFromContext - display enrichment only,
			// e.g. the invite preview's "who invited you", never a trust
			// boundary the way userIDContextKey is.
			c.Set(userNameContextKey, claims.Name)
			c.Set(userPictureContextKey, sanitizePictureURL(claims.Picture))

			return next(c)
		}
	}

	return mw, nil
}

// UserIDFromContext returns the caller's verified Keycloak subject, stashed
// by NewKeycloakAuth. ok=false means the request never passed real auth
// (e.g. middleware.Passthrough in tests) - handlers must reject rather than
// fall back to an empty user, which would otherwise claim ownership of an
// unowned list (see ListAccessService.AuthorizeWrite).
func UserIDFromContext(c echo.Context) (string, bool) {
	userID, ok := c.Get(userIDContextKey).(string)
	if !ok || userID == "" {
		return "", false
	}
	return userID, true
}

// UserProfileFromContext returns the caller's display name and picture URL,
// stashed by NewKeycloakAuth from optional JWT claims - both "" when absent
// (no ok bool: unlike UserIDFromContext, nothing here is ever authorized
// against, so there's no unset case a handler must reject).
func UserProfileFromContext(c echo.Context) (name, pictureURL string) {
	name, _ = c.Get(userNameContextKey).(string)
	pictureURL, _ = c.Get(userPictureContextKey).(string)
	return name, pictureURL
}

// allowedPictureHosts restricts the picture claim to hosts where the URL
// itself is provider-issued and never attacker-choosable (Google's avatar
// CDN). Widen this - or replace it with a per-provider proxy - only when
// adding an identity provider that doesn't host avatars itself.
var allowedPictureHosts = []string{"googleusercontent.com"}

// sanitizePictureURL drops anything that isn't an https URL on an allowed
// host. This value gets handed to every other user who previews/redeems the
// claim owner's invites, so an arbitrary host would let any account holder
// point it at a tracking pixel; restricting to Google's own CDN closes that
// off as long as Google is the only identity provider in use.
func sanitizePictureURL(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	if !isAllowedPictureHost(parsed.Hostname()) {
		return ""
	}
	return raw
}

func isAllowedPictureHost(host string) bool {
	host = strings.ToLower(host)
	for _, allowed := range allowedPictureHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	return strings.TrimPrefix(header, prefix), true
}
