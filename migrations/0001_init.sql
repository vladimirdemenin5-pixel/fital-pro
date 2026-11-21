CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_log_route_time ON request_log(route, created_at);

CREATE TABLE IF NOT EXISTS pending_orders (
  inv_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  amount TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_orders_client_ref ON pending_orders(client_ref);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount TEXT,
  currency TEXT NOT NULL DEFAULT 'RUB',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  client_ref TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  customer_contact TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_access ON subscriptions(access_token);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_ref ON subscriptions(client_ref);

CREATE TABLE IF NOT EXISTS profiles (
  access_token TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_plans (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL UNIQUE,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  access_token TEXT NOT NULL,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  completed_meal INTEGER NOT NULL DEFAULT 0,
  completed_workout INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  PRIMARY KEY(access_token, date)
);
CREATE INDEX IF NOT EXISTS idx_progress_access_date ON progress(access_token, date);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  goal TEXT,
  plan TEXT,
  created_at TEXT NOT NULL
);