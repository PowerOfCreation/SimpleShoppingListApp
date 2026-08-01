package testhelpers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
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
)

// PostgresTestContainer manages a test database container
type PostgresTestContainer struct {
	Container testcontainers.Container
	Conn      *pgx.Conn
	Queries   *db.Queries
}

// SetupTestDB creates a new PostgreSQL test container and applies the schema
func SetupTestDB(t *testing.T) *PostgresTestContainer {
	ctx := context.Background()

	// Start PostgreSQL container
	postgresContainer, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase(dbName),
		postgres.WithUsername(dbUser),
		postgres.WithPassword(dbPassword),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	require.NoError(t, err, "Failed to start postgres container")

	// Get connection string
	dsn, err := postgresContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "Failed to get connection string")

	// Connect to database
	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "Failed to connect to test database")

	// Apply schema
	err = applySchema(ctx, conn, "")
	require.NoError(t, err, "Failed to apply database schema")

	queries := db.New(conn)

	return &PostgresTestContainer{
		Container: postgresContainer,
		Conn:      conn,
		Queries:   queries,
	}
}

// SetupTestDBAtMigration behaves like SetupTestDB but stops applying
// migrations once it reaches (and includes) upToFile, e.g.
// "00003-events-processed-at.up.sql". Used by migration-specific tests that
// need to seed pre-migration data (rows a real upgrade would have to
// backfill) before applying the migration under test in isolation -
// SetupTestDB alone always leaves you on the fully-migrated schema, too
// late to observe a backfill happening.
func SetupTestDBAtMigration(t *testing.T, upToFile string) *PostgresTestContainer {
	ctx := context.Background()

	postgresContainer, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase(dbName),
		postgres.WithUsername(dbUser),
		postgres.WithPassword(dbPassword),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	require.NoError(t, err, "Failed to start postgres container")

	dsn, err := postgresContainer.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err, "Failed to get connection string")

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "Failed to connect to test database")

	err = applySchema(ctx, conn, upToFile)
	require.NoError(t, err, "Failed to apply database schema")

	return &PostgresTestContainer{
		Container: postgresContainer,
		Conn:      conn,
		Queries:   db.New(conn),
	}
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

// Close cleans up the test database and container
func (p *PostgresTestContainer) Close(t *testing.T) {
	ctx := context.Background()

	if p.Conn != nil {
		err := p.Conn.Close(ctx)
		require.NoError(t, err, "Failed to close database connection")
	}

	if p.Container != nil {
		err := p.Container.Terminate(ctx)
		require.NoError(t, err, "Failed to terminate container")
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

// applySchema applies every "*.up.sql" migration in order. If upToFile is
// non-empty, application stops once that file (inclusive) has been applied
// - used by SetupTestDBAtMigration to leave a test on an older schema.
func applySchema(ctx context.Context, conn *pgx.Conn, upToFile string) error {
	migrationsDir, err := findMigrationsDir()
	if err != nil {
		return err
	}

	migrations, err := listUpMigrations(migrationsDir)
	if err != nil {
		return err
	}

	for _, file := range migrations {
		schemaBytes, err := os.ReadFile(filepath.Join(migrationsDir, file))
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", file, err)
		}
		if _, err = conn.Exec(ctx, string(schemaBytes)); err != nil {
			return fmt.Errorf("failed to execute migration %s: %w", file, err)
		}
		if upToFile != "" && file == upToFile {
			break
		}
	}

	return nil
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
