package postgres_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/postgres"
	appmigrations "github.com/powerofcreation/simpleshoppinglistapp/migrations"
)

func TestMigrateAppliesPendingAndIsIdempotent(t *testing.T) {
	ctx := context.Background()

	pgContainer, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase("migratetest"),
		postgres.WithUsername("testuser"),
		postgres.WithPassword("testpass"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	require.NoError(t, err, "failed to start postgres container")
	defer pgContainer.Terminate(ctx)

	dsn, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "failed to get connection string")

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err, "failed to create pool")
	defer pool.Close()

	// A fresh, schema-less DB: Migrate should apply every .up.sql migration.
	err = db.Migrate(ctx, pool, appmigrations.FS)
	require.NoError(t, err, "first Migrate run should succeed")

	var versionCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations`).Scan(&versionCount))
	require.Greater(t, versionCount, 0, "expected migrations to be recorded")

	// The events table must have the columns added by migration 00004.
	var hasListID bool
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) > 0 FROM information_schema.columns
		 WHERE table_name = 'events' AND column_name = 'list_id'`).Scan(&hasListID))
	require.True(t, hasListID, "expected events.list_id after migrations")

	// A second run must be a no-op, not an error or a duplicate apply.
	err = db.Migrate(ctx, pool, appmigrations.FS)
	require.NoError(t, err, "second (idempotent) Migrate run should succeed")
}
