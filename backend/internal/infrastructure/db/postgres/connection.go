package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/powerofcreation/simpleshoppinglistapp/internal/infrastructure/db/sqlc"
)

// NewConnection returns a connection pool rather than a single *pgx.Conn.
// A lone *pgx.Conn is not safe for concurrent use, and Echo already serves
// handlers concurrently - adding the sync event-ingestor worker and
// WebSocket hub on top of that would turn an existing latent bug into a
// routine one ("conn busy" / protocol desync).
func NewConnection(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}

	// pgxpool.New only parses the config; it doesn't dial until first use.
	// Ping eagerly so an invalid DSN or unreachable host still fails fast
	// here, matching the previous pgx.Connect behavior callers depend on.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}

	return pool, nil
}

// NewQueries accepts db.DBTX rather than a concrete connection type so it
// works with both *pgxpool.Pool (production) and the *pgx.Conn used by
// testhelpers.SetupTestDB (tests stay on a single serial connection).
func NewQueries(conn db.DBTX) *db.Queries {
	return db.New(conn)
}
