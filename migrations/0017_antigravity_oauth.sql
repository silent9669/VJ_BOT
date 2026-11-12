-- Token material belongs to the dedicated gateway, never to D1 or browser storage.
CREATE TABLE IF NOT EXISTS ai_antigravity_connections (
  user_id TEXT PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  gateway_url TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  login_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('binding', 'active', 'disconnecting')),
  updated_at INTEGER NOT NULL
);

-- One live authorization at a time: the upstream Antigravity callback listener is shared.
CREATE TABLE IF NOT EXISTS ai_antigravity_oauth_states (
  handle TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL,
  state_enc TEXT,
  expires_at INTEGER NOT NULL,
  slot INTEGER NOT NULL UNIQUE CHECK (slot = 1)
);
