package entities

import (
	"fmt"
	"time"
)

// InviteTTL is one of a fixed set of validity-duration presets a client may
// request for an invite link. Presets rather than a free-form duration so an
// expiry can't be pushed out arbitrarily far (or into the past) by a client.
type InviteTTL struct {
	key      string
	duration time.Duration
}

var inviteTTLPresets = map[string]time.Duration{
	"1h":  time.Hour,
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
	"30d": 30 * 24 * time.Hour,
}

// ParseInviteTTL validates key against the fixed preset list.
func ParseInviteTTL(key string) (InviteTTL, error) {
	duration, ok := inviteTTLPresets[key]
	if !ok {
		return InviteTTL{}, fmt.Errorf("invalid invite ttl %q", key)
	}
	return InviteTTL{key: key, duration: duration}, nil
}

func (t InviteTTL) ExpiresAt(from time.Time) time.Time {
	return from.Add(t.duration)
}
