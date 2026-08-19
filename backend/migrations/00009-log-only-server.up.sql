-- The registry row becomes the ref: head_seq replaces the global
-- events_seq_seq as the source of a list's next seq, row-locked per list
-- (see AppendToList) instead of depending on "exactly one EventIngestor
-- goroutine in one process" - the invariant that made running more than one
-- API replica unsafe (see frontend/docs/sync-server-registry-roadmap.md).
ALTER TABLE synced_lists ADD COLUMN head_seq BIGINT NOT NULL DEFAULT 0;

-- idx_events_seq enforced global uniqueness of seq - it has to go before
-- the renumbering below, which deliberately reuses the same seq values
-- (1, 2, 3, ...) across different lists and would otherwise collide with
-- itself. idx_events_list_seq (list_id, seq) was never unique before this
-- migration (two lists could share a seq even under the global sequence,
-- since it was never partitioned), so only the per-list unique index
-- created further down actually needs to exist afterward.
DROP INDEX idx_events_seq;
DROP INDEX idx_events_list_seq;
DROP SEQUENCE events_seq_seq;

-- Renumber seq per list. Historical seq was assigned from one global
-- sequence; the ORDER BY here preserves that same relative order within
-- each list, so no event moves position relative to any other event in its
-- own list.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY list_id ORDER BY seq) AS rn
  FROM events
  WHERE list_id IS NOT NULL AND seq IS NOT NULL
)
UPDATE events e SET seq = ordered.rn FROM ordered WHERE e.id = ordered.id;

UPDATE synced_lists sl
SET head_seq = COALESCE((SELECT MAX(e.seq) FROM events e WHERE e.list_id = sl.id), 0);

CREATE UNIQUE INDEX idx_events_list_seq ON events(list_id, seq) WHERE list_id IS NOT NULL AND seq IS NOT NULL;

-- processed_at/idx_events_unprocessed existed only to drive the background
-- dispatch retry sweep (EventIngestor, EventDispatcher), deleted along with
-- this migration: an event is now either durably appended synchronously at
-- push time or 400-rejected before it exists at all (R1) - there is no
-- state left in between for a sweep to find.
DROP INDEX idx_events_unprocessed;
ALTER TABLE events DROP COLUMN processed_at;

-- todo_lists/todos were the server's content projection for todo_list.*
-- events - the working tree of the bare-repo analogy this roadmap is named
-- after. Nothing reads them any more (requireList and GetListHeads moved to
-- synced_lists in the preceding steps); last_applied_seq (on todo_lists)
-- and the FK from todos go with the tables.
DROP TABLE todos;
DROP TABLE todo_lists;
