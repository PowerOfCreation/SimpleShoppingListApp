-- name: CreateToDoList :one
INSERT INTO todo_lists (id, name, created_at, updated_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetToDoListById :one
SELECT p.id, p.name, p.created_at, p.updated_at
FROM todo_lists p
WHERE p.id = $1 AND p.deleted_at IS NULL;

-- name: GetAllToDoLists :many
SELECT p.id, p.name, p.created_at, p.updated_at
FROM todo_lists p
WHERE p.deleted_at IS NULL
ORDER BY p.created_at DESC;

-- name: UpdateToDoList :exec
UPDATE todo_lists 
SET name = $2, updated_at = $3
WHERE id = $1;

-- name: DeleteToDoList :exec
UPDATE todo_lists SET deleted_at = NOW() WHERE id = $1;