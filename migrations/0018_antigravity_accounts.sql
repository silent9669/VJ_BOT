-- Preserve each existing opaque login identity and its selected account.
CREATE TABLE ai_antigravity_connections_next (
  user_id TEXT NOT NULL,
  auth_id TEXT NOT NULL UNIQUE,
  gateway_url TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  login_id TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('binding', 'active', 'disconnecting')),
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Antigravity account' CHECK (length(name) BETWEEN 1 AND 80),
  PRIMARY KEY (user_id, login_id)
);
INSERT INTO ai_antigravity_connections_next(user_id,auth_id,gateway_url,prefix,login_id,model,state,updated_at)
  SELECT user_id,auth_id,gateway_url,prefix,login_id,model,state,updated_at FROM ai_antigravity_connections;
DROP TABLE ai_antigravity_connections;
ALTER TABLE ai_antigravity_connections_next RENAME TO ai_antigravity_connections;

CREATE TABLE ai_active_antigravity (
  user_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  FOREIGN KEY (user_id, connection_id) REFERENCES ai_antigravity_connections(user_id, login_id) ON DELETE CASCADE
);
INSERT INTO ai_active_antigravity(user_id,connection_id)
  SELECT user_id,login_id FROM ai_antigravity_connections;

CREATE TRIGGER ai_antigravity_account_limit BEFORE INSERT ON ai_antigravity_connections
WHEN (SELECT count(*) FROM ai_antigravity_connections WHERE user_id=NEW.user_id) >= 20
BEGIN
  SELECT RAISE(ABORT, 'Antigravity account limit reached');
END;
