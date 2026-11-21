CREATE TABLE IF NOT EXISTS access_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_recovery_access
  ON access_recovery_tokens(access_token, expires_at);
