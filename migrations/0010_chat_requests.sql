ALTER TABLE conversations ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_request_role ON conversations(user_id,request_id,role) WHERE request_id IS NOT NULL;
