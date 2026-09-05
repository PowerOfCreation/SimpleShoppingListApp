-- Lets the redeem screen show what the invite actually points at before
-- (or after) joining, without the server reading list content: list_name is
-- a snapshot the client hands in when creating the invite (may go stale if
-- the list is renamed afterwards - accepted tradeoff), and
-- created_by_name/created_by_picture_url are the inviter's own profile
-- claims from their JWT at that same moment, both optional since Keycloak
-- doesn't always populate them.
ALTER TABLE list_invites
    ADD COLUMN list_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN created_by_name TEXT,
    ADD COLUMN created_by_picture_url TEXT;
