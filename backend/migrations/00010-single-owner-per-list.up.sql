-- ClaimListOwnership's NOT EXISTS subquery isn't an exclusion under READ
-- COMMITTED: two concurrent first-claims can both pass it before either
-- commits, giving a list two owners. This index makes it one.
CREATE UNIQUE INDEX idx_list_members_single_owner ON list_members (list_id) WHERE role = 'owner';
