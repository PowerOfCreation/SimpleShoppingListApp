-- name: UpsertUserProfile :exec
INSERT INTO user_profiles (user_id, first_name) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name
WHERE user_profiles.first_name IS DISTINCT FROM EXCLUDED.first_name;

-- name: GetListMemberProfiles :many
SELECT m.user_id, COALESCE(p.first_name, '')::text AS first_name
FROM list_members m LEFT JOIN user_profiles p ON p.user_id = m.user_id
WHERE m.list_id = $1 ORDER BY m.user_id;
