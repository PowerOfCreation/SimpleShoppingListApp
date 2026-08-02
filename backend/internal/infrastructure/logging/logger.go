// Package logging builds the application's single structured logger and
// carries it through request contexts. All env access for logging
// configuration (LOG_LEVEL, LOG_FORMAT) lives here, not scattered across
// the app.
package logging

import (
	"io"
	"log/slog"
	"os"
	"runtime/debug"
	"strings"
)

const serviceName = "shopping-list-api"

// New builds the application's logger, writing structured records to w.
// LOG_LEVEL (debug|info|warn|error, default info) controls verbosity;
// LOG_FORMAT (json|text, default json) selects the encoding - text is only
// meant as a local convenience (e.g. under `air`). Every record carries a
// service and version attribute, so logs are self-describing once shipped
// off-host.
func New(w io.Writer) *slog.Logger {
	level := parseLevel(os.Getenv("LOG_LEVEL"))
	opts := &slog.HandlerOptions{
		Level:     level,
		AddSource: level == slog.LevelDebug,
	}

	var handler slog.Handler
	if strings.EqualFold(os.Getenv("LOG_FORMAT"), "text") {
		handler = slog.NewTextHandler(w, opts)
	} else {
		handler = slog.NewJSONHandler(w, opts)
	}

	return slog.New(handler).With(
		"service", serviceName,
		"version", buildVersion(),
	)
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	case "", "info":
		return slog.LevelInfo
	default:
		return slog.LevelInfo
	}
}

// buildVersion reads the VCS revision embedded by the Go toolchain, falling
// back to "dev" for builds without that info (e.g. `go run`).
func buildVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	for _, setting := range info.Settings {
		if setting.Key == "vcs.revision" {
			return setting.Value
		}
	}
	return "dev"
}
