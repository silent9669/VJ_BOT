-- Keep the existing AES-GCM ciphertext and user-id AAD unchanged; only its owning row changes shape.
ALTER TABLE ai_providers RENAME TO ai_providers_single;
CREATE TABLE ai_providers (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  connection_id TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER,
  PRIMARY KEY (user_id, id)
);
INSERT INTO ai_providers(user_id,id,name,protocol,base_url,model,key_enc,key_last4,updated_at)
  SELECT user_id,lower(hex(randomblob(16))),'API',protocol,base_url,model,key_enc,key_last4,updated_at FROM ai_providers_single;
CREATE TABLE ai_active_profiles (
  user_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  FOREIGN KEY (user_id, profile_id) REFERENCES ai_providers(user_id, id) ON DELETE CASCADE
);
INSERT INTO ai_active_profiles(user_id,profile_id) SELECT user_id,id FROM ai_providers;
DROP TABLE ai_providers_single;
-- Enforce the per-account bound within each insertion, including concurrent requests.
CREATE TRIGGER ai_profiles_limit BEFORE INSERT ON ai_providers
WHEN (SELECT count(*) FROM ai_providers WHERE user_id=NEW.user_id) >= 20
BEGIN
  SELECT RAISE(ABORT, 'ai_profiles_limit');
END;
