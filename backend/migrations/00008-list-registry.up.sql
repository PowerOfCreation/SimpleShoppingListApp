-- The list registry: the server's record that it holds a log for this list,
-- with no content whatsoever. It replaces todo_lists as the answer to "does
-- the server know this list" - a question the content projection was only
-- ever incidentally able to answer, and could get wrong whenever its
-- dispatch failed (see frontend/docs/sync-server-registry-roadmap.md).
CREATE TABLE synced_lists (
    id         UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Backfill from both sides, since neither alone is complete: todo_lists has
-- rows only for lists whose todo_list.created was projected successfully,
-- and events.list_id has rows only for lists that pushed at least one event
-- the backfill in 00004 could resolve.
INSERT INTO synced_lists (id, created_at)
SELECT id, COALESCE(created_at, NOW()) FROM todo_lists
UNION
SELECT DISTINCT list_id, NOW() FROM events WHERE list_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- A member or invite can exist for a list_id no todo_lists row was ever
-- written for - that's exactly why 00007 had to drop these FKs. Against the
-- registry the constraint is truthful again: the row is created in the same
-- transaction as the ownership claim, so a member without a parent is not
-- representable. Any access row left orphaned by an earlier state gets a
-- registry row above rather than being deleted.
INSERT INTO synced_lists (id, created_at)
SELECT DISTINCT list_id, NOW() FROM list_members
UNION
SELECT DISTINCT list_id, NOW() FROM list_invites
ON CONFLICT (id) DO NOTHING;

ALTER TABLE list_invites ADD CONSTRAINT list_invites_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES synced_lists(id) ON DELETE CASCADE;
ALTER TABLE list_members ADD CONSTRAINT list_members_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES synced_lists(id) ON DELETE CASCADE;
