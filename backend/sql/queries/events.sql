-- name: InsertEvent :one
-- Assigns seq here, not at MarkEventProcessed (see migration
-- 00006-events-seq-at-insert) - a durably received event gets its log
-- position regardless of whether its projection ever succeeds. Upserts as
-- a no-op update (rather than DO NOTHING) purely so RETURNING always
-- yields exactly one row, whether this event_id was just inserted or
-- already existed from a previous delivery; since seq isn't in the SET
-- clause, a duplicate delivery keeps its original seq and RETURNING hands
-- back that one, not a freshly burned one (nextval() is still evaluated
-- for the value list on a conflicting insert - a harmless gap, since seq's
-- only contract is monotonic-and-unique, not contiguous).
INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id, seq)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, nextval('events_seq_seq'))
ON CONFLICT (id) DO UPDATE SET id = events.id
RETURNING processed_at, seq, list_id;

-- name: MarkEventProcessed :exec
-- Only marks the row's projection attempt as finished - seq is already
-- assigned by InsertEvent. The `processed_at IS NULL` guard makes a second
-- call for the same id a genuine no-op (0 rows) rather than clobbering the
-- original timestamp: the periodic sweep can legitimately race a
-- just-finished live dispatch and call this again for the same row.
UPDATE events
SET processed_at = NOW()
WHERE id = $1 AND processed_at IS NULL;

-- name: GetUnprocessedEvents :many
-- The startup/periodic sweep's replay set - ordered by seq (unique,
-- assigned once at insert) so a retried event can never be replayed out of
-- position relative to one that arrived after it. received_at ordering
-- (pre migration 00006) had neither property: it wasn't unique, and it no
-- longer tracked seq order once seq could be assigned later than insert.
SELECT id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id, seq
FROM events
WHERE processed_at IS NULL
ORDER BY seq ASC;

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
