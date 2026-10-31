CREATE TABLE IF NOT EXISTS progress_attempts (
  user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (user_id, attempt_id)
);
