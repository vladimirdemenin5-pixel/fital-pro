CREATE TABLE IF NOT EXISTS checkout_sessions (
  client_ref TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  contact TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pd_consent_at TEXT,
  pd_policy_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_created_at ON checkout_sessions(created_at);
