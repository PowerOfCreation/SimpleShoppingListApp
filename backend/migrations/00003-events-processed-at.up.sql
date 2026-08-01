ALTER TABLE events ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;

-- Used by the startup sweep that re-dispatches events which were durably
-- inserted but never finished processing (e.g. the process crashed between
-- the insert and the dispatch step).
CREATE INDEX idx_events_unprocessed ON events(received_at) WHERE processed_at IS NULL;
