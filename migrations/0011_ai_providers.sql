CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, granted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_providers (
  user_id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
