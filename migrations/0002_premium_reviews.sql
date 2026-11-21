CREATE TABLE IF NOT EXISTS premium_reviews (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  period_start TEXT NOT NULL,
  review_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(access_token, period_start)
);
CREATE INDEX IF NOT EXISTS idx_premium_reviews_access_created
  ON premium_reviews(access_token, created_at);
