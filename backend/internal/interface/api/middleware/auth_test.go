package middleware

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

const (
	testClientID = "shopping-list"
	testKeyID    = "test-key-1"
)

// testOIDCProvider is a hand-rolled OIDC discovery + JWKS server, just
// enough for go-oidc's NewProvider/Verifier to work against. There's no
// real Keycloak in this test environment, so this stands in for one.
type testOIDCProvider struct {
	server *httptest.Server
	key    *rsa.PrivateKey
}

func newTestOIDCProvider(t *testing.T) *testOIDCProvider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	p := &testOIDCProvider{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", p.serveDiscovery)
	mux.HandleFunc("/jwks", p.serveJWKS)
	p.server = httptest.NewServer(mux)
	t.Cleanup(p.server.Close)
	return p
}

func (p *testOIDCProvider) issuer() string {
	return p.server.URL
}

func (p *testOIDCProvider) serveDiscovery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                p.issuer(),
		"authorization_endpoint":                p.issuer() + "/authorize",
		"token_endpoint":                        p.issuer() + "/token",
		"jwks_uri":                              p.issuer() + "/jwks",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
	})
}

func (p *testOIDCProvider) serveJWKS(w http.ResponseWriter, r *http.Request) {
	n := base64.RawURLEncoding.EncodeToString(p.key.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(p.key.PublicKey.E)).Bytes())

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"kid": testKeyID,
				"n":   n,
				"e":   e,
			},
		},
	})
}

// signToken hand-builds and RS256-signs a JWT with the given claims -
// there's no JWT library in go.mod, and the format is simple enough
// (base64url(header) + "." + base64url(payload), RSASSA-PKCS1-v1_5 over
// SHA-256 of that string) that adding one just for this test isn't worth
// it.
func (p *testOIDCProvider) signToken(t *testing.T, claims map[string]any) string {
	t.Helper()

	header := map[string]any{"alg": "RS256", "typ": "JWT", "kid": testKeyID}
	headerJSON, err := json.Marshal(header)
	require.NoError(t, err)
	claimsJSON, err := json.Marshal(claims)
	require.NoError(t, err)

	signingInput := base64.RawURLEncoding.EncodeToString(headerJSON) + "." +
		base64.RawURLEncoding.EncodeToString(claimsJSON)

	hashed := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, p.key, crypto.SHA256, hashed[:])
	require.NoError(t, err)

	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func defaultClaims(issuer string, overrides map[string]any) map[string]any {
	claims := map[string]any{
		"iss": issuer,
		"aud": "account",
		"azp": testClientID,
		"sub": "user-123",
		"iat": time.Now().Add(-time.Minute).Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	for k, v := range overrides {
		claims[k] = v
	}
	return claims
}

func newTestEcho(mw echo.MiddlewareFunc) (*echo.Echo, *bool) {
	called := false
	e := echo.New()
	e.GET("/protected", func(c echo.Context) error {
		called = true
		return c.NoContent(http.StatusOK)
	}, mw)
	return e, &called
}

func doGet(e *echo.Echo, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestNewKeycloakAuth_ValidTokenPasses(t *testing.T) {
	provider := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)
	token := provider.signToken(t, defaultClaims(provider.issuer(), nil))

	rec := doGet(e, token)

	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, *called)
}

func TestNewKeycloakAuth_MissingTokenReturns401(t *testing.T) {
	provider := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)

	rec := doGet(e, "")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called)
}

func TestNewKeycloakAuth_ExpiredTokenReturns401(t *testing.T) {
	provider := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)
	token := provider.signToken(t, defaultClaims(provider.issuer(), map[string]any{
		"exp": time.Now().Add(-time.Hour).Unix(),
	}))

	rec := doGet(e, token)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called)
}

func TestNewKeycloakAuth_WrongSignatureReturns401(t *testing.T) {
	provider := newTestOIDCProvider(t)
	otherKeyProvider := newTestOIDCProvider(t) // different RSA key, same kid
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)
	// Claims say it's from `provider`'s issuer, but it was actually signed
	// by a different key - the JWKS lookup for `provider`'s kid will fetch
	// its own public key, which won't verify this signature.
	token := otherKeyProvider.signToken(t, defaultClaims(provider.issuer(), nil))

	rec := doGet(e, token)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called)
}

func TestNewKeycloakAuth_WrongAzpReturns401(t *testing.T) {
	provider := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)
	token := provider.signToken(t, defaultClaims(provider.issuer(), map[string]any{
		"azp": "some-other-client",
	}))

	rec := doGet(e, token)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called)
}

func TestNewKeycloakAuth_WrongIssuerReturns401(t *testing.T) {
	provider := newTestOIDCProvider(t)
	t.Setenv(envKeycloakIssuer, provider.issuer())
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())
	require.NoError(t, err)
	e, called := newTestEcho(mw)
	token := provider.signToken(t, defaultClaims("https://not-the-configured-issuer.example", nil))

	rec := doGet(e, token)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called)
}

func TestNewKeycloakAuth_MissingConfigReturnsError(t *testing.T) {
	t.Setenv(envKeycloakIssuer, "")
	t.Setenv(envKeycloakClientID, "")

	mw, err := NewKeycloakAuth(context.Background())

	require.Error(t, err)
	require.Nil(t, mw)
}

func TestNewKeycloakAuth_UnreachableIssuerReturnsError(t *testing.T) {
	t.Setenv(envKeycloakIssuer, "http://127.0.0.1:1")
	t.Setenv(envKeycloakClientID, testClientID)

	mw, err := NewKeycloakAuth(context.Background())

	require.Error(t, err)
	require.Nil(t, mw)
}

func TestPassthrough_AlwaysCallsNext(t *testing.T) {
	e, called := newTestEcho(Passthrough)

	rec := doGet(e, "")

	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, *called)
}
