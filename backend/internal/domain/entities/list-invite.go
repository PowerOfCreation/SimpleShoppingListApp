package entities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ListInvite is a shareable, multi-use link granting membership on ListID to
// whoever presents its token before it expires or gets revoked. Only
// TokenHash is ever persisted - see InviteToken.
type ListInvite struct {
	ID        uuid.UUID
	ListID    uuid.UUID
	TokenHash string
	CreatedBy string
	CreatedAt time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
	// ListName is a snapshot of the list's name at the moment this invite
	// was created, handed in by the client - the server is content-blind
	// and has no other way to know it (sync-sharing-target.md R2). Can go
	// stale if the list is renamed afterwards; that's an accepted tradeoff
	// for showing something on the redeem screen at all.
	ListName string
	// CreatedByName and CreatedByPictureURL are the inviter's own profile
	// claims from their JWT at creation time - both empty when Keycloak
	// doesn't populate them for that user.
	CreatedByName       string
	CreatedByPictureURL string
}

func (i *ListInvite) validate() error {
	if i.ListID == uuid.Nil {
		return errors.New("list id must not be empty")
	}
	if i.CreatedBy == "" {
		return errors.New("created by must not be empty")
	}
	if i.TokenHash == "" {
		return errors.New("token hash must not be empty")
	}
	if !i.ExpiresAt.After(i.CreatedAt) {
		return errors.New("expires_at must be after created_at")
	}
	return nil
}

// NewListInvite creates a new invite for listID and returns both the invite
// (carrying only the token's hash, safe to persist) and the plaintext token
// (safe to hand back to createdBy exactly once, never stored).
func NewListInvite(
	listID uuid.UUID,
	createdBy string,
	ttl InviteTTL,
	now time.Time,
	listName string,
	createdByName string,
	createdByPictureURL string,
) (*ListInvite, InviteToken, error) {
	token, err := NewInviteToken()
	if err != nil {
		return nil, "", err
	}

	invite := &ListInvite{
		ID:                  uuid.New(),
		ListID:              listID,
		TokenHash:           token.Hash(),
		CreatedBy:           createdBy,
		CreatedAt:           now,
		ExpiresAt:           ttl.ExpiresAt(now),
		ListName:            listName,
		CreatedByName:       createdByName,
		CreatedByPictureURL: createdByPictureURL,
	}
	if err := invite.validate(); err != nil {
		return nil, "", err
	}
	return invite, token, nil
}

// IsActive reports whether the invite can still be redeemed at now.
func (i *ListInvite) IsActive(now time.Time) bool {
	return i.RevokedAt == nil && i.ExpiresAt.After(now)
}

// Revoke marks the invite revoked. Revoking an already-revoked invite is a
// no-op (idempotent) rather than an error - callers only need to reach here
// once authorized, not track whether someone beat them to it.
func (i *ListInvite) Revoke(now time.Time) {
	if i.RevokedAt != nil {
		return
	}
	i.RevokedAt = &now
}
