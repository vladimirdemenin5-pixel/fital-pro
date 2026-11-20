CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_log_lookup ON request_log(ip_hash, route, created_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  payment_id TEXT UNIQUE NOT NULL,
  client_ref TEXT UNIQUE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  access_token TEXT UNIQUE,
  customer_contact TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_token ON subscriptions(access_token);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_ref ON subscriptions(client_ref);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expires_at);
