ALTER TABLE payments ADD COLUMN client_ref TEXT;
ALTER TABLE payments ADD COLUMN draft_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_client_ref ON payments(client_ref);

CREATE TABLE IF NOT EXISTS plan_drafts (
  id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_drafts_created ON plan_drafts(created_at);
