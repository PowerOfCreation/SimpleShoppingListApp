ALTER TABLE events DROP COLUMN IF EXISTS user_id;
ALTER TABLE list_invites ADD CONSTRAINT list_invites_list_id_fkey FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE;
ALTER TABLE list_members ADD CONSTRAINT list_members_list_id_fkey FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE;
