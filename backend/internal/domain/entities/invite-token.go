package entities

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// InviteToken is the plaintext, URL-safe secret handed to whoever redeems an
// invite link. It exists only transiently - generated once by NewInviteToken,
// returned to the creator, and never itself persisted; only its Hash() is
// stored, so a database leak doesn't hand out usable invite links.
type InviteToken string

// NewInviteToken generates a 256-bit random token, base64url-encoded
// (unpadded) so it drops straight into a URL without escaping.
func NewInviteToken() (InviteToken, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return InviteToken(base64.RawURLEncoding.EncodeToString(raw)), nil
}

// Hash returns the token's stable, irreversible lookup key - what actually
// gets persisted in list_invites.token_hash.
func (t InviteToken) Hash() string {
	return HashInviteToken(string(t))
}

// HashInviteToken hashes a raw token string presented at redeem time, so it
// can be looked up against the stored hash without ever storing the token
// itself.
func HashInviteToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
