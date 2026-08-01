-- name: InsertEvent :one
-- Upserts as a no-op update (rather than DO NOTHING) purely so RETURNING
-- always yields exactly one row, whether this event_id was just inserted
-- or already existed from a previous delivery. Callers use processed_at to
-- tell the two cases apart without a second round-trip.
INSERT INTO events (id, event_type, aggregate_id, aggregate_type, payload, occurred_at, client_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET id = events.id
RETURNING processed_at;

-- name: MarkEventProcessed :exec
UPDATE events SET processed_at = NOW() WHERE id = $1;

-- name: GetUnprocessedEvents :many
SELECT id, event_type, aggregate_id, aggregate_type, payload, occurred_at, client_id
FROM events
WHERE processed_at IS NULL
ORDER BY received_at ASC;

-- name: GetKnownEventIds :many
SELECT id
FROM events
WHERE aggregate_id = ANY(sqlc.arg(aggregate_ids)::uuid[])
  AND processed_at IS NOT NULL;
