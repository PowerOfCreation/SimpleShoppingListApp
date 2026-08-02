package main

import (
	"context"
	"log"
	"os"

	"github.com/labstack/echo/v4"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/services"
	postgres2 "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/realtime"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=todos port=5432 sslmode=disable"
	}
	port := ":8080"

	ctx := context.Background()
	pool, err := postgres2.NewConnection(ctx, dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	queries := postgres2.NewQueries(pool)

	toDoListRepo := postgres2.NewSqlcToDoListRepository(queries)
	eventRepo := postgres2.NewSqlcEventRepository(queries)

	toDoListService := services.NewToDoListService(toDoListRepo)

	eventDispatcher := services.NewEventDispatcher(
		services.NewCreateToDoListEventHandler(toDoListService),
		services.NewUpdateToDoListEventHandler(toDoListService),
		services.NewDeleteToDoListEventHandler(toDoListService),
	)

	hub := realtime.NewHub()
	eventIngestor := services.NewEventIngestor(eventRepo, eventDispatcher, hub)
	eventIngestor.Start(ctx)
	defer eventIngestor.Stop()

	authMW, err := middleware.NewKeycloakAuth(ctx)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}

	e := echo.New()
	rest.NewToDoListController(e, toDoListService)
	rest.NewEventController(e, eventIngestor, authMW)
	rest.NewSyncWebSocketController(e, hub, authMW)
	rest.NewSyncStateController(e, eventRepo, authMW)
	rest.NewSyncPullController(e, eventRepo, authMW)

	if err := e.Start(port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
