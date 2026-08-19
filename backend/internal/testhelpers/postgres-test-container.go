package testhelpers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used by Snapshot/Restore below
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

const (
	dbUser     = "testuser"
	dbPassword = "testpass"
	dbName     = "testdb"

	// fullSnapshotName is the Postgres template database holding the schema
	// after every migration has been applied - what SetupTestDB restores.
	fullSnapshotName = "full-schema"
)

// PostgresTestContainer manages a test database container
type PostgresTestContainer struct {
	Container testcontainers.Container
	Conn      *pgx.Conn
	Queries   *db.Queries
}

// sharedContainer is started at most once per test binary and reused by
// every SetupTestDB / SetupTestDBAtMigration call for the rest of the run.
// A fresh container per test function used to dominate this package's test
// time (container startup + a full migration replay, times ~70 call
// sites). Postgres's snapshot/restore feature (CREATE DATABASE ... WITH
// TEMPLATE) gives every test the same clean-schema guarantee for a fraction
// of the cost: migrations are applied once, each migration boundary is
// snapshotted, and each test just restores the snapshot it needs. See
// https://golang.testcontainers.org/modules/postgres/#snapshots-and-restoring.
// The container is intentionally never explicitly terminated - it's a
// process-lifetime fixture, and testcontainers' Ryuk reaper removes it once
// the test binary exits.
var (
	sharedContainerOnce sync.Once
	sharedContainer     *postgres.PostgresContainer
	sharedContainerErr  error
)

// SetupTestDB restores the fully-migrated schema snapshot on the shared
// test container and returns a fresh connection to it.
func SetupTestDB(t *testing.T) *PostgresTestContainer {
	return restoreSnapshot(t, fullSnapshotName)
}

// SetupTestDBAtMigration behaves like SetupTestDB but restores the snapshot
// taken right after upToFile was applied, e.g. "00003-events-processed-at.up.sql"
// instead of the fully-migrated schema. Used by migration-specific tests
// that need to seed pre-migration data (rows a real upgrade would have to
// backfill) before applying the migration under test in isolation.
func SetupTestDBAtMigration(t *testing.T, upToFile string) *PostgresTestContainer {
	return restoreSnapshot(t, upToFile)
}

// restoreSnapshot resets the shared container's main database to the given
// snapshot and hands back a new connection to it.
func restoreSnapshot(t *testing.T, snapshotName string) *PostgresTestContainer {
	ctx := context.Background()

	sharedContainerOnce.Do(func() {
		sharedContainer, sharedContainerErr = startSharedContainer(ctx)
	})
	require.NoError(t, sharedContainerErr, "failed to start shared postgres test container")

	err := sharedContainer.Restore(ctx, postgres.WithSnapshotName(snapshotName))
	require.NoError(t, err, "failed to restore snapshot %s", snapshotName)

	dsn, err := sharedContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "failed to get connection string")

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "failed to connect to test database")

	return &PostgresTestContainer{
		Container: sharedContainer,
		Conn:      conn,
		Queries:   db.New(conn),
	}
}

// startSharedContainer boots the one Postgres container this test binary
// uses, applies every "*.up.sql" migration in order against it, and
// snapshots the database after each one - including the final,
// fully-migrated state under fullSnapshotName - so restoreSnapshot never
// has to touch the filesystem or re-run SQL again.
func startSharedContainer(ctx context.Context) (*postgres.PostgresContainer, error) {
	container, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase(dbName),
		postgres.WithUsername(dbUser),
		postgres.WithPassword(dbPassword),
		postgres.WithSQLDriver("pgx"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to start postgres container: %w", err)
	}
	cleanupOnError := func(cause error) (*postgres.PostgresContainer, error) {
		if terminateErr := container.Terminate(ctx); terminateErr != nil {
			return nil, fmt.Errorf("%w (also failed to terminate postgres container after setup failure: %v)", cause, terminateErr)
		}
		return nil, cause
	}

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return cleanupOnError(fmt.Errorf("failed to get connection string: %w", err))
	}

	migrationsDir, err := findMigrationsDir()
	if err != nil {
		return cleanupOnError(err)
	}
	migrations, err := listUpMigrations(migrationsDir)
	if err != nil {
		return cleanupOnError(err)
	}

	for _, file := range migrations {
		schemaBytes, err := os.ReadFile(filepath.Join(migrationsDir, file))
		if err != nil {
			return cleanupOnError(fmt.Errorf("failed to read migration file %s: %w", file, err))
		}

		// Connect fresh, apply, and disconnect for every migration:
		// Snapshot's CREATE DATABASE ... WITH TEMPLATE fails while any other
		// connection (including this one) is open against the source db.
		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			return cleanupOnError(fmt.Errorf("failed to connect to test database: %w", err))
		}
		_, err = conn.Exec(ctx, string(schemaBytes))
		conn.Close(ctx)
		if err != nil {
			return cleanupOnError(fmt.Errorf("failed to execute migration %s: %w", file, err))
		}

		if err := container.Snapshot(ctx, postgres.WithSnapshotName(file)); err != nil {
			return cleanupOnError(fmt.Errorf("failed to snapshot after migration %s: %w", file, err))
		}
	}

	if err := container.Snapshot(ctx, postgres.WithSnapshotName(fullSnapshotName)); err != nil {
		return cleanupOnError(fmt.Errorf("failed to snapshot full schema: %w", err))
	}

	return container, nil
}

// ApplyMigration applies a single "*.up.sql" migration file by name against
// this container's connection - the counterpart to
// SetupTestDBAtMigration, letting a test seed data on an older schema and
// then step forward through the migration under test.
func (p *PostgresTestContainer) ApplyMigration(t *testing.T, file string) {
	migrationsDir, err := findMigrationsDir()
	require.NoError(t, err)

	schemaBytes, err := os.ReadFile(filepath.Join(migrationsDir, file))
	require.NoError(t, err, "failed to read migration file %s", file)

	_, err = p.Conn.Exec(context.Background(), string(schemaBytes))
	require.NoError(t, err, "failed to execute migration %s", file)
}

// Close closes this test's connection to the shared container. The
// container itself outlives the test - see sharedContainer above.
func (p *PostgresTestContainer) Close(t *testing.T) {
	if p.Conn != nil {
		err := p.Conn.Close(context.Background())
		require.NoError(t, err, "Failed to close database connection")
	}
}

// findMigrationsDir locates backend/migrations by walking up from the
// current working directory to the module root (identified by go.mod) -
// package tests run with their own package directory as cwd, so this
// can't just be a relative path.
func findMigrationsDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}

	projectRoot := cwd
	for {
		if _, err := os.Stat(filepath.Join(projectRoot, "go.mod")); err == nil {
			break
		}
		parent := filepath.Dir(projectRoot)
		if parent == projectRoot {
			return "", fmt.Errorf("could not find project root (go.mod not found)")
		}
		projectRoot = parent
	}

	return filepath.Join(projectRoot, "migrations"), nil
}

// listUpMigrations discovers every "*.up.sql" file in dir and returns their
// names sorted lexically (the "NNNNN-description.up.sql" naming convention
// makes lexical order the same as migration order). Reading the directory
// rather than hardcoding the file list means new migrations are picked up
// automatically - a hardcoded list here has already gone stale once (it
// stopped at 00003 while a 00004 migration existed), silently running every
// test against an outdated schema instead of failing loudly.
func listUpMigrations(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read migrations directory: %w", err)
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

// TruncateTables cleans all test data from the database tables
func (p *PostgresTestContainer) TruncateTables(t *testing.T) {
	ctx := context.Background()

	// Truncate tables in dependency order (child tables first)
	tables := []string{"products", "idempotency_records", "sellers"}

	for _, table := range tables {
		_, err := p.Conn.Exec(ctx, fmt.Sprintf("TRUNCATE TABLE %s CASCADE", table))
		require.NoError(t, err, "Failed to truncate table %s", table)
	}
}
