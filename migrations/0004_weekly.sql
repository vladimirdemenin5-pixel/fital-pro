CREATE TABLE IF NOT EXISTS weekly_plans (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_token ON weekly_plans(access_token);
