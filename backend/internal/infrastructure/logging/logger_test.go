package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseLevel(t *testing.T) {
	tests := map[string]slog.Level{
		"":         slog.LevelInfo,
		"info":     slog.LevelInfo,
		"INFO":     slog.LevelInfo,
		"debug":    slog.LevelDebug,
		"warn":     slog.LevelWarn,
		"warning":  slog.LevelWarn,
		"error":    slog.LevelError,
		"nonsense": slog.LevelInfo,
	}
	for raw, want := range tests {
		assert.Equal(t, want, parseLevel(raw), "input %q", raw)
	}
}

func TestNew_EmitsStructuredJSONWithBaseAttributes(t *testing.T) {
	t.Setenv("LOG_LEVEL", "info")
	t.Setenv("LOG_FORMAT", "json")

	var buf bytes.Buffer
	logger := New(&buf)
	logger.Info("hello", "foo", "bar")

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &decoded))
	assert.Equal(t, "hello", decoded["msg"])
	assert.Equal(t, "INFO", decoded["level"])
	assert.Equal(t, serviceName, decoded["service"])
	assert.Equal(t, "bar", decoded["foo"])
	assert.NotEmpty(t, decoded["version"])
}

func TestNew_RespectsLevelFilter(t *testing.T) {
	t.Setenv("LOG_LEVEL", "warn")

	var buf bytes.Buffer
	logger := New(&buf)
	logger.Info("should be filtered out")
	assert.Empty(t, buf.String())

	logger.Warn("should appear")
	assert.NotEmpty(t, buf.String())
}

func TestContext_RoundTrip(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	ctx := NewContext(context.Background(), logger)
	assert.Same(t, logger, FromContext(ctx))
}

func TestContext_FallsBackToDefault(t *testing.T) {
	assert.Same(t, slog.Default(), FromContext(context.Background()))
}
