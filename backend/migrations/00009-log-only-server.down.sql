-- Schema-only rollback. todo_lists was a rebuildable projection with no
-- rebuild mechanism of its own (sync-sharing-target.md §6.1) - it was never
-- authoritative, so recreating the empty tables restores every later
-- migration's ability to reference them (00007's down does), but their
-- content is not, and cannot be, recovered. Nothing is lost that wasn't
-- already only derivable from the event log.
CREATE TABLE todo_lists (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    last_applied_seq BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_todo_lists_deleted_at ON todo_lists(deleted_at);

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
CREATE INDEX idx_todos_deleted_at ON todos(deleted_at);

ALTER TABLE events ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;
UPDATE events SET processed_at = received_at WHERE seq IS NOT NULL;
CREATE INDEX idx_events_unprocessed ON events(seq) WHERE processed_at IS NULL;

DROP INDEX idx_events_list_seq;
CREATE INDEX idx_events_list_seq ON events(list_id, seq);

-- The up migration made seq per-list (two different lists can both have an
-- event at seq 1) - the opposite of what the global idx_events_seq below
-- requires. Schema-only rollback again: this renumbers seq back to a
-- single global, gap-free sequence in (list_id, seq) order, which restores
-- the uniqueness invariant but not the original global ordering - that
-- ordering wasn't preserved by the up migration's per-list renumbering
-- either, so nothing further is lost by this.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY list_id NULLS LAST, seq NULLS LAST, id) AS rn
  FROM events
)
UPDATE events e SET seq = ordered.rn FROM ordered WHERE e.id = ordered.id AND e.seq IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS events_seq_seq;
DO $$
DECLARE
  max_seq BIGINT;
BEGIN
  SELECT MAX(seq) INTO max_seq FROM events;
  IF max_seq IS NOT NULL THEN
    PERFORM setval('events_seq_seq', max_seq, true);
  END IF;
END $$;
CREATE UNIQUE INDEX idx_events_seq ON events(seq) WHERE seq IS NOT NULL;

ALTER TABLE synced_lists DROP COLUMN head_seq;
