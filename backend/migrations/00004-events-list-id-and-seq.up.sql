-- list_id groups every event (todo_list.* and ingredient.*) by the list it
-- belongs to, regardless of aggregate_id (which is the ingredient id for
-- ingredient.* events, not the list). Populated by the client going
-- forward; backfilled below for existing rows. Nullable: an event whose
-- list could not be resolved during backfill (or an older client that
-- doesn't send it yet) simply has no list_id and is never returned by the
-- list-scoped pull endpoints.
ALTER TABLE events ADD COLUMN list_id UUID;

-- seq is a monotonically increasing, gap-free-on-commit cursor used by the
-- pull endpoints (GET /api/v1/sync/events, POST /api/v1/sync/head) to know
-- "everything up to here". It is deliberately NOT a BIGSERIAL assigned at
-- INSERT time: sequence values are handed out at insert but only become
-- visible at commit, so two concurrent inserts can commit out of order and
-- a reader could observe seq=5 while seq=4 is still uncommitted - a classic
-- gap that would silently and permanently lose event 4 for any client that
-- had already advanced its cursor past 5.
--
-- Instead seq is assigned by MarkEventProcessed (see 00004 query changes),
-- which only ever runs from EventIngestor's single worker goroutine, in
-- strict FIFO order, as its own autocommit statement outside any longer
-- transaction. That makes assignment order == commit order == visibility
-- order, and doubles as "seq IS NOT NULL" meaning "durably processed" -
-- exactly the set pull should serve. This only holds with a single
-- ingestor writer; scaling the ingestor to multiple replicas requires
-- either a leader election / advisory lock around it, or serving pull only
-- up to a watermark below any in-flight seq. See
-- frontend/docs/sync-design-decisions.md.
ALTER TABLE events ADD COLUMN seq BIGINT;

CREATE SEQUENCE IF NOT EXISTS events_seq_seq;

CREATE UNIQUE INDEX idx_events_seq ON events(seq) WHERE seq IS NOT NULL;
CREATE INDEX idx_events_list_seq ON events(list_id, seq);

-- --- Backfill list_id for rows that predate this column ---

-- Step 1: todo_list.* events - the list *is* the aggregate.
UPDATE events SET list_id = aggregate_id WHERE aggregate_type = 'todo_list';

-- Step 2: ingredient.created carries the parent list id in its payload
-- ({name, listId}). Guarded by a UUID-shaped regex so malformed/legacy
-- payloads can't abort the migration on a bad cast.
UPDATE events
SET list_id = (payload ->> 'listId')::uuid
WHERE event_type = 'ingredient.created'
  AND payload ->> 'listId' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Step 3: every other ingredient.* event (updated/deleted/priority_*) only
-- carries the ingredient id as aggregate_id, not the list - resolve it by
-- joining back to that ingredient's own ingredient.created event, which
-- step 2 just backfilled.
UPDATE events e
SET list_id = c.list_id
FROM events c
WHERE e.aggregate_type = 'ingredient'
  AND e.list_id IS NULL
  AND c.event_type = 'ingredient.created'
  AND c.aggregate_id = e.aggregate_id
  AND c.list_id IS NOT NULL;

-- --- Backfill seq for already-processed rows ---
--
-- Historical commit order wasn't tracked before this migration, so
-- received_at (with id as a stable tiebreak for same-timestamp rows) is the
-- closest available approximation.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY received_at ASC, id ASC) AS rn
  FROM events
  WHERE processed_at IS NOT NULL
)
UPDATE events e
SET seq = ordered.rn
FROM ordered
WHERE e.id = ordered.id;

-- Only advance the sequence if something was actually backfilled - a fresh
-- database has no rows, and setval() rejects 0 (sequences start at 1), so
-- an unconditional setval would fail on every fresh install/test run.
DO $$
DECLARE
  max_seq BIGINT;
BEGIN
  SELECT MAX(seq) INTO max_seq FROM events;
  IF max_seq IS NOT NULL THEN
    PERFORM setval('events_seq_seq', max_seq, true);
  END IF;
END $$;
