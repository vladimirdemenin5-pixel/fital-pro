CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  goal TEXT,
  plan TEXT,
  created_at TEXT NOT NULL,
  pd_consent_at TEXT,
  pd_policy_version TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  plan TEXT,
  amount TEXT,
  currency TEXT,
  created_at TEXT NOT NULL
);
