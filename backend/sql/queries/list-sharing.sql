-- name: InsertListInvite :exec
INSERT INTO list_invites (id, list_id, token_hash, created_by, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: GetListInviteById :one
SELECT id, list_id, token_hash, created_by, created_at, expires_at, revoked_at
FROM list_invites
WHERE id = $1;

-- name: GetListInviteByTokenHash :one
SELECT id, list_id, token_hash, created_by, created_at, expires_at, revoked_at
FROM list_invites
WHERE token_hash = $1;

-- name: GetActiveListInvites :many
-- An invite is active if it hasn't been revoked and hasn't expired as of
-- sqlc.arg(now) - the caller passes the current time rather than this query
-- using NOW() so results are reproducible in tests.
SELECT id, list_id, token_hash, created_by, created_at, expires_at, revoked_at
FROM list_invites
WHERE list_id = sqlc.arg(list_id)
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg(now)
ORDER BY created_at DESC;

-- name: RevokeListInvite :exec
-- The `revoked_at IS NULL` guard makes revoking an already-revoked invite a
-- true no-op (zero rows affected) rather than overwriting the original
-- revocation time - ListSharingService treats both as success either way,
-- but this keeps the first revocation timestamp authoritative.
UPDATE list_invites
SET revoked_at = sqlc.arg(revoked_at)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: ClaimListOwnership :one
-- Adds the caller as owner only if listID has no members yet at all, and
-- registers the list in the same statement. :one + zero rows
-- (pgx.ErrNoRows) means the list already had members and no membership was
-- written.
--
-- The registry insert is a data-modifying CTE rather than a second
-- round-trip so the two can't diverge: Postgres runs it exactly once and to
-- completion, and list_members' foreign key is checked after the whole
-- statement, by which point the parent row exists. A member row without a
-- registry row is therefore not representable - which is what makes the
-- foreign key added in 00008 truthful rather than aspirational.
WITH registered AS (
    INSERT INTO synced_lists (id, created_at)
    VALUES (sqlc.arg(list_id), sqlc.arg(joined_at))
    ON CONFLICT (id) DO NOTHING
)
INSERT INTO list_members (list_id, user_id, role, joined_at)
SELECT sqlc.arg(list_id), sqlc.arg(user_id), 'owner', sqlc.arg(joined_at)
WHERE NOT EXISTS (SELECT 1 FROM list_members WHERE list_id = sqlc.arg(list_id))
RETURNING list_id;

-- name: SyncedListExists :one
-- "Does the server hold a log for this list" - the registry replacement for
-- the old todo_lists existence check. Deliberately returns no content: the
-- server has none to return.
SELECT EXISTS (SELECT 1 FROM synced_lists WHERE id = $1);

-- name: AddListMember :exec
-- Idempotent on (list_id, user_id) so redeeming an invite for a list you're
-- already on (including the invite you just claimed ownership with) is a
-- safe no-op rather than a primary key violation.
INSERT INTO list_members (list_id, user_id, role, joined_at, invite_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (list_id, user_id) DO NOTHING;

-- name: GetListMember :one
SELECT list_id, user_id, role, joined_at, invite_id
FROM list_members
WHERE list_id = $1 AND user_id = $2;

-- name: GetClaimedListIDs :many
-- Which of the given list ids already have at least one member, regardless
-- of who - the pre-check behind ListAccessService.AuthorizeWrite's claim
-- phase. Distinguishes "nobody has pushed to this list yet" (eligible for
-- ClaimOwnershipIfUnowned) from "someone else already owns it" (must be
-- rejected) without granting access or claiming anything itself.
SELECT DISTINCT list_id
FROM list_members
WHERE list_id = ANY(sqlc.arg(list_ids)::uuid[]);

-- name: GetAccessibleListIDs :many
-- Which of the given list ids the caller is a member (owner or member) of -
-- the filter behind every read path (ListAccessService.FilterAccessible).
-- Deliberately returns a subset rather than erroring on a list the caller
-- has no access to: a batch read (e.g. /sync/head) must not turn into an
-- enumeration oracle that tells a caller "that id exists but isn't yours"
-- vs. "that id doesn't exist" - both simply come back missing.
SELECT list_id
FROM list_members
WHERE list_id = ANY(sqlc.arg(list_ids)::uuid[]) AND user_id = sqlc.arg(user_id);
