-- ToDoLists table
CREATE TABLE todo_lists (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- ToDo table
CREATE TABLE todos (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    todo_list_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (todo_list_id) REFERENCES todo_lists(id)
);

-- Indexes
CREATE INDEX idx_todo_lists_deleted_at ON todo_lists(deleted_at);
CREATE INDEX idx_todos_deleted_at ON todos(deleted_at);