DROP INDEX IF EXISTS idx_events_unprocessed;
ALTER TABLE events DROP COLUMN IF EXISTS processed_at;
