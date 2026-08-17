-- name: CreateToDoList :exec
-- Projection, not an aggregate: a re-delivered created may update an
-- existing row, but must never resurrect a tombstoned one (deleted_at IS
-- NULL) or rewind one a later event already applied (last_applied_seq) -
-- see migration 00006-events-seq-at-insert. The two guards are not
-- redundant: deleted_at blocks a *newer* create from reviving a tombstone
-- (terminal, regardless of seq); last_applied_seq blocks an *older* event
-- (e.g. a create the sweep retried after a later update already landed)
-- from clobbering newer content.
INSERT INTO todo_lists (id, name, created_at, updated_at, last_applied_seq)
VALUES ($1, $2, $3, $4, sqlc.arg(at_seq))
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      last_applied_seq = EXCLUDED.last_applied_seq
  WHERE todo_lists.deleted_at IS NULL
    AND todo_lists.last_applied_seq < EXCLUDED.last_applied_seq;

-- name: GetToDoListById :one
SELECT p.id, p.name, p.created_at, p.updated_at
FROM todo_lists p
WHERE p.id = $1 AND p.deleted_at IS NULL;

-- name: UpdateToDoList :exec
-- Missing or already-deleted row: zero rows affected, not an error - the
-- row is a rebuildable projection, not the authority. last_applied_seq
-- guard: see CreateToDoList above.
UPDATE todo_lists
SET name = $2, updated_at = $3, last_applied_seq = sqlc.arg(at_seq)
WHERE id = $1
  AND deleted_at IS NULL
  AND last_applied_seq < sqlc.arg(at_seq);

-- name: DeleteToDoList :exec
-- Tombstone upsert: idempotent via the deleted_at IS NULL guard - the
-- first tombstone timestamp sticks, deleted_at is terminal (see 6.2 in
-- sync-sharing-target.md). name is left empty for a list never otherwise
-- seen; that row is unreadable (every read filters deleted_at IS NULL).
--
-- Deliberately no last_applied_seq guard here, unlike Create/Update above:
-- a delete must apply even when its own seq is *lower* than what's already
-- landed, e.g. a delete durably received early but stuck on a transient
-- failure until a sweep retries it, after an update with a higher seq
-- already applied live. A full in-order rebuild of the same history would
-- apply the delete first and then reject that update via its own
-- deleted_at IS NULL guard (see 6.1) - the frontend's handleDeleted
-- (ingredient-list-projection.ts) confirms this: it hard-deletes the row,
-- so a later-processed update in the same rebuild just no-ops against a
-- row that no longer exists. Guarding this delete on last_applied_seq
-- would make this projection diverge from that outcome instead of
-- converging to it - the seq comparison the guard would perform is exactly
-- backwards for a terminal write. last_applied_seq is still set here (to
-- at_seq, unconditionally) purely so a row this query creates or touches
-- reports an accurate watermark if ever inspected outside the normal
-- deleted_at IS NULL read path; no future guard check ever consults it
-- again once deleted_at is set, since deleted_at IS NULL is already the
-- universal gate ahead of it on every other write.
INSERT INTO todo_lists (id, name, created_at, updated_at, deleted_at, last_applied_seq)
VALUES ($1, '', sqlc.arg(tombstoned_at), sqlc.arg(tombstoned_at), sqlc.arg(tombstoned_at), sqlc.arg(at_seq))
ON CONFLICT (id) DO UPDATE
  SET deleted_at = EXCLUDED.deleted_at,
      last_applied_seq = EXCLUDED.last_applied_seq
  WHERE todo_lists.deleted_at IS NULL;
