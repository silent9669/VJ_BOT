-- Keep teaching state outside the bounded dialogue window and fence in-flight generations.
CREATE TABLE tutor_sessions (
  user_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  state_json TEXT,
  history_after INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, context_key)
);

CREATE TABLE tutor_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'complete')),
  lease_token TEXT NOT NULL,
  lease_expires INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
