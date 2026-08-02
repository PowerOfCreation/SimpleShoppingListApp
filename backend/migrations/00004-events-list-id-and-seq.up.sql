-- Groups every event by the list it belongs to, regardless of
-- aggregate_id (the ingredient id for ingredient.* events, not the list).
-- Nullable: an unresolvable or pre-backfill row just has no list_id and is
-- never returned by the list-scoped pull endpoints. Backfilled below; see
-- sync-design-decisions.md.
ALTER TABLE events ADD COLUMN list_id UUID;

-- Monotonically increasing, gap-free-on-commit pull cursor. Deliberately
-- NOT a BIGSERIAL assigned at INSERT - concurrent commits could become
-- visible out of order and leave a gap. Assigned instead by
-- MarkEventProcessed, which only ever runs from EventIngestor's single
-- worker goroutine in strict FIFO order. Holds only with a single ingestor
-- writer; see sync-design-decisions.md ("seq wird beim MarkProcessed
-- vergeben").
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
