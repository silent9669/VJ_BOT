-- Additive private learning-cycle evidence; historical attempts remain unchanged.
ALTER TABLE task_attempt_evidence ADD COLUMN session_id TEXT;
ALTER TABLE task_attempt_evidence ADD COLUMN feedback_json TEXT;
ALTER TABLE task_attempt_evidence ADD COLUMN feedback_at TEXT;
CREATE INDEX task_evidence_session ON task_attempt_evidence(user_id,session_id,task_id,answered_at);
