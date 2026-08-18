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

// timePtrFromTimestamptz converts a nullable pgx timestamptz into a *time.Time.
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

// pgtypeTextFromString converts a domain string, where "" means "not set"
// (e.g. StoredEvent.UserID for events accepted before access enforcement
// existed), into pgx's nullable text type - "" becomes NULL rather than a
// stored empty string.
func pgtypeTextFromString(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// stringFromPgtypeText is the inverse of pgtypeTextFromString.
func stringFromPgtypeText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
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
