-- GetListsForUser (the "restore my lists" discovery endpoint, GET
-- /api/v1/todo-lists) filters list_members by user_id alone. The table's
-- only indexes are the (list_id, user_id) primary key and the partial
-- single-owner index on list_id - neither covers a user_id-only lookup, so
-- without this index every call is a full table scan.
CREATE INDEX idx_list_members_user_id ON list_members (user_id);
