CREATE TABLE IF NOT EXISTS progress (
  access_token TEXT NOT NULL,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  completed_meal INTEGER DEFAULT 0,
  completed_workout INTEGER DEFAULT 0,
  note TEXT,
  PRIMARY KEY(access_token,date)
);
CREATE INDEX IF NOT EXISTS idx_progress_token_date ON progress(access_token,date);
