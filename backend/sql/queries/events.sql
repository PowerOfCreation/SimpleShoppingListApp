-- name: InsertEvent :one
-- Upserts as a no-op update (rather than DO NOTHING) purely so RETURNING
-- always yields exactly one row, whether this event_id was just inserted
-- or already existed from a previous delivery. Callers use processed_at to
-- tell the two cases apart without a second round-trip; seq/list_id ride
-- along so a duplicate delivery can still ack with the event's seq.
INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET id = events.id
RETURNING processed_at, seq, list_id;

-- name: MarkEventProcessed :one
-- Assigns seq from the dedicated events_seq_seq sequence atomically with
-- marking the row processed (see migration 00004 for why seq is assigned
-- here rather than at insert). The `seq IS NULL` guard makes a second call
-- for the same id a no-op that returns zero rows rather than silently
-- handing out a second seq - callers can only reach this for a row that
-- was genuinely never marked before, so a zero-row result signals a bug,
-- not a legitimate race (see EventIngestor's single-writer guarantee).
UPDATE events
SET processed_at = NOW(), seq = nextval('events_seq_seq')
WHERE id = $1 AND seq IS NULL
RETURNING seq, list_id;

-- name: GetUnprocessedEvents :many
SELECT id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id
FROM events
WHERE processed_at IS NULL
ORDER BY received_at ASC;

-- name: GetKnownEventIdsByList :many
-- Which of a set of lists' events this server has durably processed - the
-- reconcile self-heal endpoint's query. Keyed by list_id rather than
-- aggregate_id: aggregate_id is the ingredient id for ingredient.* events,
-- so a single list can span arbitrarily many aggregate_ids, but always has
-- exactly one list_id.
SELECT id
FROM events
WHERE list_id = ANY(sqlc.arg(list_ids)::uuid[])
  AND seq IS NOT NULL;

-- name: GetListHeads :many
-- The latest (list_id, seq, id) per requested list - "what's the most
-- recent event you have for this list". Lists with zero processed events
-- simply produce no row; the controller fills in the seq=0 head itself so
-- every requested id still appears in the response.
SELECT DISTINCT ON (list_id) list_id, seq, id
FROM events
WHERE list_id = ANY(sqlc.arg(list_ids)::uuid[])
  AND seq IS NOT NULL
ORDER BY list_id, seq DESC;

-- name: GetEventsSince :many
-- Pull page: every event for one list with seq strictly greater than
-- since_seq, oldest-first, capped at limit_count. The controller requests
-- limit_count+0 rows and treats a full page as "there may be more" (see
-- sync-pull-controller.go) rather than asking for limit+1 here, keeping
-- this query's shape identical to what it returns.
SELECT id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id, seq
FROM events
WHERE list_id = sqlc.arg(list_id)
  AND seq IS NOT NULL
  AND seq > sqlc.arg(since_seq)
ORDER BY seq ASC
LIMIT sqlc.arg(limit_count);
