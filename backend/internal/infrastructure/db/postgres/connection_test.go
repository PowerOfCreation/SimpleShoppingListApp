package postgres

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/testhelpers"
)

func TestNewConnection(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	// Test NewQueries with the existing connection (we can't easily get a new DSN)
	queries := NewQueries(testDB.Conn)
	assert.NotNil(t, queries)

	// Verify the connection is working by using the existing connection
	ctx := context.Background()
	err := testDB.Conn.Ping(ctx)
	assert.NoError(t, err)
}

func TestNewConnection_InvalidDSN(t *testing.T) {
	ctx := context.Background()

	// Test with invalid DSN
	conn, err := NewConnection(ctx, "invalid-dsn")
	assert.Error(t, err)
	assert.Nil(t, conn)
}

func TestNewConnection_UnreachableHost(t *testing.T) {
	ctx := context.Background()

	// Test with unreachable host
	conn, err := NewConnection(ctx, "postgres://user:pass@unreachable-host:5432/db?connect_timeout=1")
	assert.Error(t, err)
	assert.Nil(t, conn)
}

func TestNewQueries(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	// Test NewQueries with valid connection
	queries := NewQueries(testDB.Conn)
	assert.NotNil(t, queries)

	// Verify queries object is functional by running a simple query
	ctx := context.Background()
	_, err := queries.SyncedListExists(ctx, uuid.New())
	assert.NoError(t, err) // Should not error even for an unknown list
}

// TestNewConnection_ConcurrentQueries guards against regressing to a
// single, non-poolable *pgx.Conn: pgx documents *pgx.Conn as unsafe for
// concurrent use, which becomes a routine failure (not just a latent one)
// once background sync work runs alongside request handlers. NewConnection
// must return something that many goroutines can query at once.
func TestNewConnection_ConcurrentQueries(t *testing.T) {
	testDB := testhelpers.SetupTestDB(t)
	defer testDB.Close(t)

	dsn := testDB.Container.(interface {
		ConnectionString(ctx context.Context, args ...string) (string, error)
	})
	connString, err := dsn.ConnectionString(context.Background(), "sslmode=disable")
	require.NoError(t, err)

	ctx := context.Background()
	pool, err := NewConnection(ctx, connString)
	require.NoError(t, err)
	defer pool.Close()

	const concurrency = 20
	var wg sync.WaitGroup
	errs := make([]error, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			var one int
			errs[idx] = pool.QueryRow(ctx, "SELECT 1").Scan(&one)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		assert.NoError(t, err, "goroutine %d failed", i)
	}
}

func TestNewQueries_WithNilConnection(t *testing.T) {
	// Test NewQueries with nil connection
	// Note: This will create a queries object but will panic when used
	queries := NewQueries(nil)
	assert.NotNil(t, queries)

	// Attempting to use it should panic (so we won't test that)
	// This test just verifies that NewQueries can accept nil without immediately panicking
}
