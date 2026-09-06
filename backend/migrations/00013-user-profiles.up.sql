CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY CHECK (user_id <> ''),
    first_name TEXT NOT NULL
);
