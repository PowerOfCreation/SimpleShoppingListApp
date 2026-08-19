ALTER TABLE list_invites DROP CONSTRAINT list_invites_list_id_fkey;
ALTER TABLE list_members DROP CONSTRAINT list_members_list_id_fkey;
DROP TABLE synced_lists;
