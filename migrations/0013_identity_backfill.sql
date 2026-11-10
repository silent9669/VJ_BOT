-- Email accounts: copy the identity that already exists in password_accounts.
UPDATE profiles SET
  email = COALESCE(email, (SELECT email FROM password_accounts a WHERE a.user_id = profiles.user_id)),
  name = COALESCE(name, (SELECT name FROM password_accounts a WHERE a.user_id = profiles.user_id))
WHERE user_id LIKE 'email:%';
-- Any account with a live or past session keeps that display name.
UPDATE profiles SET name = (SELECT name FROM sessions s WHERE s.user_id = profiles.user_id LIMIT 1)
WHERE name IS NULL AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = profiles.user_id);
UPDATE profiles SET created_at = COALESCE(created_at, updated_at);
