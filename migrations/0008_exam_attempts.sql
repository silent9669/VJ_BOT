CREATE TABLE IF NOT EXISTS exam_attempts (
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, paper_id)
);
