package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	postgres2 "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/logging"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/realtime"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest"
	appmigrations "github.com/powerofcreation/simpleshoppinglistapp/migrations"
)

func main() {
	logger := logging.New(os.Stdout)
	// Every component here gets logger via DI, not slog.Default() - this
	// only exists so a stray stdlib log.Print in a dependency we don't
	// control (or a future log.Println someone reaches for instead of the
	// injected logger) still lands in the same JSON stream instead of
	// unstructured plaintext on stderr.
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=todos port=5432 sslmode=disable"
	}
	port := ":8080"

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres2.NewConnection(ctx, dsn)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer pool.Close()

	// Apply pending schema migrations before anything touches the DB.
	if err := postgres2.Migrate(ctx, logger, pool, appmigrations.FS); err != nil {
		return fmt.Errorf("failed to apply migrations: %w", err)
	}

	queries := postgres2.NewQueries(pool)

	eventRepo := postgres2.NewSqlcEventRepository(pool, queries)
	listInviteRepo := postgres2.NewSqlcListInviteRepository(queries)
	listMemberRepo := postgres2.NewSqlcListMemberRepository(queries)
	syncedListRepo := postgres2.NewSqlcSyncedListRepository(queries)

	listAccessService := services.NewListAccessService(listMemberRepo)
	listSharingService := services.NewListSharingService(logger, listInviteRepo, listMemberRepo, syncedListRepo, listAccessService)

	hub := realtime.NewHub(logger, listAccessService)

	authMW, err := middleware.NewKeycloakAuth(ctx, logger)
	if err != nil {
		return fmt.Errorf("auth: %w", err)
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.HTTPErrorHandler = httpErrorHandler(logger, e.DefaultHTTPErrorHandler)

	e.Use(echomw.RequestID())
	e.Use(echomw.RecoverWithConfig(echomw.RecoverConfig{
		LogErrorFunc: func(c echo.Context, err error, stack []byte) error {
			middleware.RequestScopedLogger(logger, c).Error("panic recovered", "error", err, "stack", string(stack))
			return err
		},
	}))
	e.Use(middleware.RequestLogger(logger))
	e.Use(middleware.ContextLogger(logger))

	// Unauthenticated on purpose: container/orchestrator liveness probes
	// have no Keycloak token. Registered after migrations and Keycloak
	// discovery above already succeeded, so 200 here means the process is
	// actually ready to serve, not just that the binary started.
	e.GET("/healthz", func(c echo.Context) error {
		return c.NoContent(http.StatusOK)
	})

	rest.NewEventController(e, logger, eventRepo, listAccessService, hub, authMW)
	rest.NewSyncWebSocketController(e, hub, authMW)
	rest.NewSyncStateController(e, logger, eventRepo, listAccessService, authMW)
	rest.NewSyncPullController(e, logger, eventRepo, listAccessService, authMW)
	rest.NewListSharingController(e, logger, listSharingService, authMW)

	errCh := make(chan error, 1)
	go func() {
		if err := e.Start(port); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()
	logger.Info("server starting", "port", port)

	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("failed to start server: %w", err)
		}
		return nil
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	// Comfortably under Docker/Compose's default 10s SIGTERM->SIGKILL grace
	// period.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var shutdownErr error
	if err := e.Shutdown(shutdownCtx); err != nil {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("http server shutdown: %w", err))
	}
	// e.Shutdown does not close or wait for hijacked connections (the sync
	// websocket), so the hub closes and waits for those separately.
	if err := hub.Shutdown(shutdownCtx); err != nil {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("hub shutdown: %w", err))
	}
	if err := <-errCh; err != nil {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("server error during shutdown: %w", err))
	}

	logger.Info("server stopped")
	return shutdownErr
}

// httpErrorHandler logs errors that never went through a controller's own
// JSON response (e.g. a failed websocket upgrade, or Echo's own 404/405) -
// level by status, same convention as the access log - then delegates to
// fallback for the actual response.
//
// middleware.RequestLogger's HandleError:true already forwards handler
// errors here via c.Error before they bubble back up to Echo's own
// ServeHTTP, which then calls this same handler a second time with the
// identical error (see echo's RequestLoggerWithConfig doc comment) - so,
// same as Echo's own DefaultHTTPErrorHandler, this is a no-op once the
// response is already committed, to avoid logging (and trying to write)
// the same error twice.
func httpErrorHandler(logger *slog.Logger, fallback echo.HTTPErrorHandler) echo.HTTPErrorHandler {
	return func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}

		status := http.StatusInternalServerError
		if he, ok := err.(*echo.HTTPError); ok {
			status = he.Code
		}

		l := middleware.RequestScopedLogger(logger, c)
		switch {
		case status >= 500:
			l.Error("http error", "status", status, "error", err)
		case status >= 400:
			l.Warn("http error", "status", status, "error", err)
		}

		fallback(err, c)
	}
}
