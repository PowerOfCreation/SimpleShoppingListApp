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
-- Adds the caller as owner only if listID has no members yet at all - the
-- bootstrap for lists that predate this feature and never had an owner
-- recorded anywhere. NOT EXISTS and the INSERT run as one statement so the
-- common case doesn't need two round-trips. :one + zero rows (pgx.ErrNoRows)
-- means the list already had members and nothing was written.
INSERT INTO list_members (list_id, user_id, role, joined_at)
SELECT sqlc.arg(list_id), sqlc.arg(user_id), 'owner', sqlc.arg(joined_at)
WHERE NOT EXISTS (SELECT 1 FROM list_members WHERE list_id = sqlc.arg(list_id))
RETURNING list_id;

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
