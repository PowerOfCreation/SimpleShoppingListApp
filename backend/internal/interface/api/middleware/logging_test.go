package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
)

func TestRequestLogger_HealthzOnlyLoggedOnFailure(t *testing.T) {
	cases := []struct {
		status  int
		wantLog bool
	}{
		{http.StatusOK, false},
		{http.StatusServiceUnavailable, true},
	}
	for _, tc := range cases {
		var buf bytes.Buffer
		e := echo.New()
		e.Use(RequestLogger(slog.New(slog.NewJSONHandler(&buf, nil))))
		e.GET("/healthz", func(c *echo.Context) error { return c.NoContent(tc.status) })

		e.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/healthz", nil))

		require.Equal(t, tc.wantLog, buf.Len() > 0, "status %d", tc.status)
	}
}
