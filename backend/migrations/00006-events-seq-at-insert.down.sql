ALTER TABLE todo_lists DROP COLUMN IF EXISTS last_applied_seq;
DROP INDEX IF EXISTS idx_events_unprocessed;
CREATE INDEX idx_events_unprocessed ON events(received_at) WHERE processed_at IS NULL;
