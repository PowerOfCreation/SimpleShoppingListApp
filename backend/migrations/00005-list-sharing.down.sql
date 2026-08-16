-- list_members must drop before list_invites - it holds the FK
-- (invite_id -> list_invites.id).
DROP TABLE IF EXISTS list_members;
DROP INDEX IF EXISTS idx_list_invites_list_active;
DROP TABLE IF EXISTS list_invites;
