-- name: CreateToDoList :exec
-- Projection, not an aggregate: a re-delivered created may update an
-- existing row, but must never resurrect one that's already tombstoned.
INSERT INTO todo_lists (id, name, created_at, updated_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at
  WHERE todo_lists.deleted_at IS NULL;

-- name: GetToDoListById :one
SELECT p.id, p.name, p.created_at, p.updated_at
FROM todo_lists p
WHERE p.id = $1 AND p.deleted_at IS NULL;

-- name: UpdateToDoList :exec
-- Missing or already-deleted row: zero rows affected, not an error - the
-- row is a rebuildable projection, not the authority.
UPDATE todo_lists
SET name = $2, updated_at = $3
WHERE id = $1 AND todo_lists.deleted_at IS NULL;

-- name: DeleteToDoList :exec
-- Tombstone upsert: a deleted event that arrives before its created (the
-- unprocessed-event sweep can replay a previously-failed create after a
-- later delete already landed) still plants the tombstone row itself, so
-- the later created bounces off the deleted_at IS NULL guard above. The
-- WHERE guard in DO UPDATE makes this idempotent - the first tombstone
-- timestamp sticks. name is left empty for a list never otherwise seen;
-- that row is unreadable (every read filters deleted_at IS NULL).
INSERT INTO todo_lists (id, name, created_at, updated_at, deleted_at)
VALUES ($1, '', $2, $2, $2)
ON CONFLICT (id) DO UPDATE
  SET deleted_at = EXCLUDED.deleted_at
  WHERE todo_lists.deleted_at IS NULL;