package logging

import (
	"context"
	"log/slog"
)

type contextKey struct{}

// NewContext returns a copy of ctx carrying l as the request-scoped logger.
func NewContext(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, l)
}

// FromContext returns the logger stashed by NewContext, or slog.Default()
// if none was set - callers never need a nil check.
func FromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(contextKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}
