CREATE TABLE IF NOT EXISTS profiles (
  access_token TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
