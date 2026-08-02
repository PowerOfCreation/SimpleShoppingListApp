package postgres

import (
	"context"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationsTableDDL creates the bookkeeping table that tracks which
// migration versions have already been applied. Run first, every startup,
// so it can never be the reason a later migration is skipped incorrectly.
const migrationsTableDDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

// advisoryLockKey is an arbitrary-but-stable advisory lock id. It is used to
// guarantee that only one API process migrates at a time (e.g. two replicas,
// or air plus a manual go run) — the second one blocks until the first
// finishes. Advisory locks are session-scoped, so it must be taken and
// released on the same single connection.
const advisoryLockKey = int64(-8876109641015196089)

// Migrate applies every pending "*.up.sql" migration in sqlFS, in lexical
// order (the "NNNNN-description.up.sql" naming convention makes lexical
// order the migration order). Each migration runs inside its own
// transaction: it either fully applies *and* is recorded in
// schema_migrations, or it is rolled back entirely and not recorded.
// Already-applied versions are skipped, so Migrate is safe to run on every
// startup.
func Migrate(ctx context.Context, pool *pgxpool.Pool, sqlFS fs.FS) error {
	// One dedicated connection for the whole run so the advisory lock and
	// the migrations live on the same session.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("migrate: acquire connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockKey); err != nil {
		return fmt.Errorf("migrate: acquire advisory lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockKey)
	}()

	if _, err := conn.Exec(ctx, migrationsTableDDL); err != nil {
		return fmt.Errorf("migrate: create schema_migrations: %w", err)
	}

	names, err := fs.Glob(sqlFS, "*.up.sql")
	if err != nil {
		return fmt.Errorf("migrate: list migrations: %w", err)
	}
	sort.Strings(names)

	for _, name := range names {
		applied, err := migrationApplied(ctx, conn, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		if err := applyMigration(ctx, conn, sqlFS, name); err != nil {
			return err
		}
	}
	return nil
}

// migrationApplied reports whether version has already been recorded in
// schema_migrations.
func migrationApplied(ctx context.Context, conn *pgxpool.Conn, version string) (bool, error) {
	var applied bool
	if err := conn.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`,
		version,
	).Scan(&applied); err != nil {
		return false, fmt.Errorf("migrate: check %s: %w", version, err)
	}
	return applied, nil
}

// applyMigration reads a single migration file from sqlFS and runs it inside
// a transaction together with its schema_migrations record, committing only
// if both succeed.
func applyMigration(ctx context.Context, conn *pgxpool.Conn, sqlFS fs.FS, name string) error {
	body, err := fs.ReadFile(sqlFS, name)
	if err != nil {
		return fmt.Errorf("migrate: read %s: %w", name, err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migrate: begin %s: %w", name, err)
	}
	defer func() {
		_ = tx.Rollback(context.Background())
	}()

	if _, err := tx.Exec(ctx, string(body)); err != nil {
		return fmt.Errorf("migrate %s: %w", name, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1)`, name,
	); err != nil {
		return fmt.Errorf("migrate: record %s: %w", name, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("migrate: commit %s: %w", name, err)
	}
	return nil
}
