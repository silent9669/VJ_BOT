CREATE TABLE IF NOT EXISTS admin_ai_preferences (
  user_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL DEFAULT '',
  live_voice TEXT NOT NULL DEFAULT 'shida'
);
