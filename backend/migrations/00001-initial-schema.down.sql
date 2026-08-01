-- Drop indexes
DROP INDEX IF EXISTS idx_todo_lists_deleted_at;
DROP INDEX IF EXISTS idx_todos_deleted_at;

-- Drop tables
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS todo_lists;