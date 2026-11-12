-- Preserve existing conversations as a read-only archive; never replay them into new tutor scopes.
ALTER TABLE conversations ADD COLUMN context_key TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX conversations_owner_context ON conversations(user_id, context_key, id);
