-- Additive only: API-key profiles and existing conversation history are unchanged.
CREATE TABLE ai_google_oauth (
  user_id TEXT PRIMARY KEY,
  token_enc TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE ai_google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  verifier_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ai_google_oauth_states_owner ON ai_google_oauth_states(user_id);
