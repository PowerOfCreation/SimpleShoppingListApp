-- name: CreateToDo :one
INSERT INTO todos (id, name, is_completed, todo_list_id, created_at, updated_at, completed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetToDoById :one
SELECT p.id, p.name, p.is_completed, p.todo_list_id, p.created_at, p.updated_at, p.completed_at
FROM todos p
WHERE p.id = $1 AND p.deleted_at IS NULL;

-- name: GetAllToDos :many
SELECT p.id, p.name, p.is_completed, p.todo_list_id, p.created_at, p.updated_at, p.completed_at
FROM todos p
WHERE p.deleted_at IS NULL
ORDER BY p.created_at DESC;

-- name: UpdateToDo :exec
UPDATE todos 
SET name = $2, is_completed = $3, todo_list_id = $4, updated_at = $5, completed_at = $6
WHERE id = $1;

-- name: DeleteToDo :exec
UPDATE todos SET deleted_at = NOW() WHERE id = $1;