-- seq now gets assigned at InsertEvent time, not MarkEventProcessed - see
-- sync-design-decisions.md ("seq wird beim MarkProcessed vergeben") for why
-- that comment is now historical. Insert runs in the same single
-- EventIngestor worker goroutine as MarkProcessed did, as its own
-- autocommit statement, so the vergabe=commit=visibility argument that
-- justified assigning seq at MarkProcessed carries over unchanged to
-- assigning it at Insert instead. What changes is that a durably-received
-- event now gets its log position independently of whether its projection
-- ever succeeds, closing the gap where a transiently-failed event could be
-- replayed into a *later* seq than an event that arrived after it.

-- The unprocessed sweep now replays in seq order (unique, gap-tolerant,
-- assigned once at Insert) instead of received_at (not unique, not even
-- monotonic with insertion once a row can be re-ordered by retry).
DROP INDEX idx_events_unprocessed;
CREATE INDEX idx_events_unprocessed ON events(seq) WHERE processed_at IS NULL;

-- Backfill seq for rows inserted under the old schema that never finished
-- processing - after this migration, seq IS NOT NULL must mean "durably in
-- the log" unconditionally, not "durably in the log and its projection
-- happened to succeed". Same shape as migration 00004's backfill: order by
-- received_at with id as a stable tiebreak, since arrival order wasn't
-- tracked more precisely than that before now.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY received_at ASC, id ASC) AS rn
  FROM events
  WHERE seq IS NULL
)
UPDATE events e
SET seq = ordered.rn + COALESCE((SELECT MAX(seq) FROM events), 0)
FROM ordered
WHERE e.id = ordered.id;

DO $$
DECLARE
  max_seq BIGINT;
BEGIN
  SELECT MAX(seq) INTO max_seq FROM events;
  IF max_seq IS NOT NULL THEN
    PERFORM setval('events_seq_seq', max_seq, true);
  END IF;
END $$;

-- The projection's own high-water mark: lets a write guard against
-- applying an event older (by seq) than what it already reflects, instead
-- of relying on replay arriving in order - which the sweep never
-- guaranteed and, before this migration, actively could violate. Default 0
-- so a fresh row accepts anything; backfilled from each list's own
-- processed events below so a replay right after deploy can't undo a
-- current row.
ALTER TABLE todo_lists ADD COLUMN last_applied_seq BIGINT NOT NULL DEFAULT 0;

-- Filtered on processed_at, not seq: the backfill just above gave every
-- still-unprocessed row a seq too (that's the whole point of this
-- migration), so seq IS NOT NULL no longer means "was actually applied to
-- a projection". A row whose handler never ran must not count toward this
-- list's watermark - otherwise the eventual real apply of that event (via
-- the sweep) would find its own seq already "covered" and silently no-op,
-- permanently losing its effect.
UPDATE todo_lists t
SET last_applied_seq = COALESCE(
  (SELECT MAX(e.seq) FROM events e WHERE e.list_id = t.id AND e.processed_at IS NOT NULL),
  0
);
