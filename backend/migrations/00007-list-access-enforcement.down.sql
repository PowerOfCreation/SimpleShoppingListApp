ALTER TABLE events DROP COLUMN IF EXISTS user_id;

-- The up migration deliberately allows list_members/list_invites rows for a
-- list_id todo_lists has never seen (access is claimed synchronously at
-- push time, before any todo_lists row exists - see the up migration).
-- Re-adding the FK below would fail the moment such a row exists, i.e.
-- after the first push of any new list. Deleting them here is a rollback,
-- not a no-op: it discards access data (who owns/is a member of a list)
-- for every list whose todo_lists projection hasn't caught up yet.
DELETE FROM list_members WHERE list_id NOT IN (SELECT id FROM todo_lists);
DELETE FROM list_invites WHERE list_id NOT IN (SELECT id FROM todo_lists);

ALTER TABLE list_invites ADD CONSTRAINT list_invites_list_id_fkey FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE;
ALTER TABLE list_members ADD CONSTRAINT list_members_list_id_fkey FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE;
