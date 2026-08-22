package middleware

import (
	"log/slog"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/logging"
)

// RequestLogger builds an access-log middleware: one structured line per
// request, level chosen by response status (>=500 error, >=400 warn, else
// info). Skips the sync websocket route - those connections live for
// minutes, and an access-log entry with a multi-minute "latency" would be
// misleading; the hub logs its own connect/disconnect (see realtime.Hub).
// Also skips /metrics - periodic scrapes aren't a meaningful access-log
// entry and would just add noise.
func RequestLogger(logger *slog.Logger) echo.MiddlewareFunc {
	return echomw.RequestLoggerWithConfig(echomw.RequestLoggerConfig{
		Skipper: func(c echo.Context) bool {
			return c.Path() == "/api/v1/sync/ws" || c.Path() == "/metrics"
		},
		LogRemoteIP:      true,
		LogMethod:        true,
		LogURI:           true,
		LogStatus:        true,
		LogLatency:       true,
		LogUserAgent:     true,
		LogRequestID:     true,
		LogContentLength: true,
		LogResponseSize:  true,
		LogError:         true,
		HandleError:      true,
		LogValuesFunc: func(c echo.Context, v echomw.RequestLoggerValues) error {
			level := slog.LevelInfo
			switch {
			case v.Status >= 500:
				level = slog.LevelError
			case v.Status >= 400:
				level = slog.LevelWarn
			}
			logger.LogAttrs(c.Request().Context(), level, "request",
				slog.String("request_id", v.RequestID),
				slog.String("remote_ip", v.RemoteIP),
				slog.String("method", v.Method),
				slog.String("uri", v.URI),
				slog.Int("status", v.Status),
				slog.Duration("latency", v.Latency),
				slog.String("user_agent", v.UserAgent),
				slog.String("content_length", v.ContentLength),
				slog.Int64("response_size", v.ResponseSize),
				slog.Any("error", v.Error),
			)
			return nil
		},
	})
}

// ContextLogger stashes a request-scoped logger (tagged with request_id) in
// the request context, so anything downstream that receives ctx - repos,
// the event ingestor's Enqueue - can log with the same correlation id
// without threading a logger through every call.
func ContextLogger(logger *slog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			requestLogger := logger.With("request_id", c.Response().Header().Get(echo.HeaderXRequestID))
			c.SetRequest(c.Request().WithContext(logging.NewContext(c.Request().Context(), requestLogger)))
			return next(c)
		}
	}
}

// RequestScopedLogger returns a logger tagged with the current request's id
// and, once authenticated, its user id (see middleware.NewKeycloakAuth) -
// the shared helper every REST controller uses so 500 paths log with
// consistent correlation fields instead of copy-pasted attribute lists.
func RequestScopedLogger(base *slog.Logger, c echo.Context) *slog.Logger {
	l := base.With("request_id", c.Response().Header().Get(echo.HeaderXRequestID))
	if userID, ok := UserIDFromContext(c); ok {
		l = l.With("user_id", userID)
	}
	return l
}
