-- A shareable, multi-use invite link. Only token_hash is ever persisted -
-- the plaintext token is generated and returned exactly once, by the
-- create-invite call, and never stored (see entities.InviteToken).
CREATE TABLE list_invites (
    id         UUID PRIMARY KEY,
    list_id    UUID NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL, -- Keycloak sub of the inviter
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);

-- Serves "list a list's active invites" (GetActiveListInvites), whose
-- WHERE clause is list_id + revoked_at IS NULL + expires_at > now(). Keying
-- on (list_id, expires_at) under the same partial predicate lets Postgres
-- satisfy all three conditions from the index itself - the partial
-- predicate covers revoked_at, and expires_at being an index column (not
-- just a post-filter) lets it range-scan straight to the expires_at > now()
-- rows instead of filtering every non-revoked row for this list.
CREATE INDEX idx_list_invites_list_active ON list_invites(list_id, expires_at) WHERE revoked_at IS NULL;

-- Membership on a list, either bootstrapped ("claim-on-first-invite" - see
-- ClaimListOwnership below) or granted by redeeming a ListInvite.
CREATE TABLE list_members (
    list_id   UUID NOT NULL REFERENCES todo_lists(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL, -- Keycloak sub; server-set, never client-supplied
    role      TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
    -- NULL for the claim-on-first-invite owner (no invite was redeemed).
    -- References list_invites so a membership can never point at an
    -- invite that doesn't exist.
    invite_id UUID REFERENCES list_invites(id),
    PRIMARY KEY (list_id, user_id)
);

-- Deliberately no unique index enforcing "at most one owner per list" here.
-- claim-on-first-invite is a bootstrap for lists that predate this feature
-- and predate any ownership model at all; it will be superseded once list
-- creation itself records an owner from the verified JWT (planned
-- tenant/user-isolation work). Two concurrent first-invites under READ
-- COMMITTED could in theory both insert an owner row, but that grants
-- neither party anything they don't already have today (knowing a list's
-- UUID already means full read/write access) - not worth a constraint that
-- would need its own migration to relax once co-owners become a real case.
