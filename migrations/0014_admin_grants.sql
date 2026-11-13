-- Owners are still verified Google accounts in ADMIN_EMAILS. Delegated roles are revocable.
CREATE TABLE IF NOT EXISTS admin_grants (
  user_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL
);
