-- list_members becomes the authority for "does the server know this list",
-- not todo_lists (see b8e60d9: todo_lists is a rebuildable projection, not
-- authority - a projection is the wrong place to hang an access-control
-- table's referential integrity on). Access is now claimed synchronously at
-- push time (EventController), before any todo_lists row can exist, so an
-- owner row must be insertable for a list_id todo_lists has never seen.
-- Dropping these FKs (not the columns) is what makes that possible; the
-- ON DELETE CASCADE they carried is superseded by DELETE .../sync (see
-- sync-sharing-target.md 4.4) explicitly deleting members/invites itself.
ALTER TABLE list_members DROP CONSTRAINT list_members_list_id_fkey;
ALTER TABLE list_invites DROP CONSTRAINT list_invites_list_id_fkey;

-- Verified Keycloak sub, set by the push handler (which still has the
-- request context) and never by the async EventIngestor worker (which
-- doesn't - see sync-sharing-target.md 7.1). Nullable: rows accepted before
-- this migration have no verified identity and, deliberately, get no
-- backfill (no real user data exists yet - see PR description) - they stay
-- outside every list_members-based access check, same as any other event
-- for a list nobody has claimed.
ALTER TABLE events ADD COLUMN user_id TEXT;
