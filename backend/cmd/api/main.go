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

	"github.com/labstack/echo/v5"
	echomw "github.com/labstack/echo/v5/middleware"
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

	userProfileRepo := postgres2.NewSqlcUserProfileRepository(queries)

	listAccessService := services.NewListAccessService(listMemberRepo)
	listSharingService := services.NewListSharingService(logger, listInviteRepo, listMemberRepo, syncedListRepo, listAccessService)

	hub := realtime.NewHub(logger, listAccessService)

	authMW, err := middleware.NewKeycloakAuth(ctx, logger, userProfileRepo)
	if err != nil {
		return fmt.Errorf("auth: %w", err)
	}

	e := echo.New()
	e.Logger = logger
	e.HTTPErrorHandler = httpErrorHandler(logger, echo.DefaultHTTPErrorHandler(false))

	e.Use(echomw.RequestID())
	// Panic details (stack included) are logged in httpErrorHandler, via the
	// *echomw.PanicStackError that Recover wraps the panic in - v5 dropped
	// RecoverConfig.LogErrorFunc, so there's no separate hook here anymore.
	e.Use(echomw.Recover())
	e.Use(middleware.RequestLogger(logger))
	e.Use(middleware.ContextLogger(logger))

	// Unauthenticated on purpose: container/orchestrator liveness probes
	// have no Keycloak token. Registered after migrations and Keycloak
	// discovery above already succeeded, so 200 here means the process is
	// actually ready to serve, not just that the binary started.
	e.GET("/healthz", func(c *echo.Context) error {
		return c.NoContent(http.StatusOK)
	})

	rest.NewMetricsController(e)

	rest.NewEventController(e, logger, eventRepo, listAccessService, hub, authMW)
	rest.NewSyncWebSocketController(e, hub, authMW)
	rest.NewSyncStateController(e, logger, eventRepo, listAccessService, authMW)
	rest.NewSyncPullController(e, logger, eventRepo, listAccessService, authMW)
	rest.NewListSharingController(e, logger, listSharingService, authMW)
	rest.NewListMembersController(e, logger, services.NewListMembersService(userProfileRepo, listAccessService), authMW)

	var shutdownErr error
	sc := echo.StartConfig{
		Address:    port,
		HideBanner: true,
		HidePort:   true,
		// Comfortably under Docker/Compose's default 10s SIGTERM->SIGKILL
		// grace period.
		GracefulTimeout: 8 * time.Second,
		OnShutdownError: func(err error) {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("http server shutdown: %w", err))
		},
	}
	logger.Info("server starting", "port", port)

	// sc.Start blocks until ctx is cancelled, then runs its own graceful
	// shutdown and only returns once that's done - it does not close or
	// wait for hijacked connections (the sync websocket) though, so the
	// hub is closed and waited on separately below.
	startErr := sc.Start(ctx, e)
	logger.Info("http server drained")
	if startErr != nil {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("http server: %w", startErr))
	}

	hubShutdownCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := hub.Shutdown(hubShutdownCtx); err != nil {
		shutdownErr = errors.Join(shutdownErr, fmt.Errorf("hub shutdown: %w", err))
	}

	logger.Info("server stopped")
	return shutdownErr
}

// httpErrorHandler logs errors that never went through a controller's own
// JSON response (e.g. a failed websocket upgrade, a panic, or Echo's own
// 404/405) - level by status, same convention as the access log - then
// delegates to fallback for the actual response.
//
// middleware.RequestLogger's HandleError:true already forwards handler
// errors here via c.Error before they bubble back up to Echo's own
// ServeHTTP, which then calls this same handler a second time with the
// identical error (see echo's RequestLoggerWithConfig doc comment) - so,
// same as Echo's own DefaultHTTPErrorHandler, this is a no-op once the
// response is already committed, to avoid logging (and trying to write)
// the same error twice.
func httpErrorHandler(logger *slog.Logger, fallback echo.HTTPErrorHandler) echo.HTTPErrorHandler {
	return func(c *echo.Context, err error) {
		if r, unwrapErr := echo.UnwrapResponse(c.Response()); unwrapErr == nil && r.Committed {
			return
		}

		l := middleware.RequestScopedLogger(logger, c)

		// echomw.Recover wraps a recovered panic in this before it reaches
		// here (v5 dropped RecoverConfig.LogErrorFunc) - log it with its
		// stack same as before, in addition to the status-based logging.
		var panicErr *echomw.PanicStackError
		if errors.As(err, &panicErr) {
			l.Error("panic recovered", "error", panicErr.Err, "stack", string(panicErr.Stack))
		}

		status := echo.StatusCode(err)
		if status == 0 {
			status = http.StatusInternalServerError
		}
		switch {
		case status >= 500:
			l.Error("http error", "status", status, "error", err)
		case status >= 400:
			l.Warn("http error", "status", status, "error", err)
		}

		fallback(c, err)
	}
}
