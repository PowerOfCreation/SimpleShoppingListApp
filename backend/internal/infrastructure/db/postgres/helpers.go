package postgres

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func timestamptzFromTime(t time.Time) pgtype.Timestamptz {
	var ts pgtype.Timestamptz
	ts.Scan(t)
	return ts
}

func timeFromTimestamptz(ts pgtype.Timestamptz) time.Time {
	if ts.Valid {
		return ts.Time
	}
	return time.Time{}
}

// timestamptzFromTimePtr is the nullable counterpart to timestamptzFromTime,
// for optional timestamps like list_invites.revoked_at.
func timestamptzFromTimePtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return timestamptzFromTime(*t)
}

// timePtrFromTimestamptz is the inverse of timestamptzFromTimePtr.
func timePtrFromTimestamptz(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}

// pgtypeFromUUIDPtr converts a nullable domain uuid.UUID (nil = not
// resolved / not sent by an older client) into pgx's nullable wire type.
func pgtypeFromUUIDPtr(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// uuidPtrFromPgtype is the inverse of pgtypeFromUUIDPtr.
func uuidPtrFromPgtype(id pgtype.UUID) *uuid.UUID {
	if !id.Valid {
		return nil
	}
	value := uuid.UUID(id.Bytes)
	return &value
}

func numericFromFloat64(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	// Convert float64 to string first, then scan
	n.Scan(fmt.Sprintf("%.2f", f))
	return n
}

func float64FromNumeric(n pgtype.Numeric) float64 {
	f, _ := n.Float64Value()
	return f.Float64
}
