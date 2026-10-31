CREATE TABLE IF NOT EXISTS completions (
  user_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_id)
);
