-- name: InsertEventAtSeq :one
-- Assigns the caller-supplied seq directly rather than pulling from a
-- global sequence - seq is now a per-list, gap-free counter derived from
-- synced_lists.head_seq under that row's lock (see AppendToList), not a
-- process-wide invariant (see migration 00009-log-only-server). ON CONFLICT
-- DO NOTHING rather than the old no-op-update-for-RETURNING trick: :one
-- reports pgx.ErrNoRows on a duplicate delivery, which is exactly the
-- signal the caller needs to know it must not consume a fresh seq from its
-- running head_seq counter for this event.
INSERT INTO events (id, event_type, aggregate_id, aggregate_type, list_id, payload, occurred_at, client_id, seq, user_id)
VALUES (sqlc.arg(id), sqlc.arg(event_type), sqlc.arg(aggregate_id), sqlc.arg(aggregate_type), sqlc.arg(list_id), sqlc.arg(payload), sqlc.arg(occurred_at), sqlc.arg(client_id), sqlc.arg(seq), sqlc.arg(user_id))
ON CONFLICT (id) DO NOTHING
RETURNING seq;

-- name: GetEventSeq :one
-- Looks up the seq an event was already assigned by an earlier delivery -
-- the fallback InsertEventAtSeq's caller takes on a conflict.
SELECT seq FROM events WHERE id = sqlc.arg(id);

-- name: GetKnownEventIdsByList :many
-- Which of a set of lists' events this server has durably received - the
-- reconcile self-heal endpoint's query. Every row in `events` is now
-- durably accepted the moment it exists (see AppendToList/R1), so this is
-- simply "does a row exist", with no processed/unprocessed distinction left
-- to make. Keyed by list_id rather than aggregate_id: aggregate_id is the
-- ingredient id for ingredient.* events, so a single list can span
-- arbitrarily many aggregate_ids, but always has exactly one list_id.
SELECT id
FROM events
WHERE list_id = ANY(sqlc.arg(list_ids)::uuid[]);

-- name: GetListHeads :many
-- The current pull cursor for every requested list that the registry knows
-- about: head_seq plus the id of the event at that seq (NULL when
-- head_seq is 0 - a registered-but-empty list, e.g. claimed but not yet
-- pushed to). A list the registry has no row for produces no row here at
-- all, same omission-based "unknown" signal FindAccessibleListIDs already
-- uses elsewhere - see sync-pull-controller.go on why that must stay
-- indistinguishable from "not yours".
SELECT sl.id AS list_id, sl.head_seq AS seq, e.id AS event_id
FROM synced_lists sl
LEFT JOIN events e ON e.list_id = sl.id AND e.seq = sl.head_seq
WHERE sl.id = ANY(sqlc.arg(list_ids)::uuid[]);

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
