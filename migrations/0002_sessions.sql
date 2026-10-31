CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,bucket));
CREATE TABLE IF NOT EXISTS study_days (user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(user_id,day));
