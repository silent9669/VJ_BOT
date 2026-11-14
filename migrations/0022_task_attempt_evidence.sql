-- Additive, forward-only evidence; no historical rescoring or guessed review basis.
ALTER TABLE progress_attempts ADD COLUMN submission TEXT;
ALTER TABLE profiles ADD COLUMN task_evidence_epoch TEXT;
UPDATE profiles SET task_evidence_epoch=lower(hex(randomblob(16)));
CREATE TRIGGER initialize_profile_task_epoch AFTER INSERT ON profiles
WHEN NEW.task_evidence_epoch IS NULL BEGIN
  UPDATE profiles SET task_evidence_epoch=lower(hex(randomblob(16))) WHERE user_id=NEW.user_id;
END;
CREATE TABLE task_attempt_evidence (
  user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  lesson_id TEXT,
  level TEXT,
  task_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision TEXT,
  view TEXT,
  question_index INTEGER,
  mode TEXT NOT NULL,
  identity_json TEXT NOT NULL,
  account_epoch TEXT,
  answer_payload TEXT,
  answer_index INTEGER,
  response_text TEXT,
  self_rating INTEGER,
  source_correct INTEGER,
  basis TEXT NOT NULL DEFAULT 'legacy_unknown',
  validity TEXT NOT NULL DEFAULT 'unknown',
  disposition TEXT NOT NULL DEFAULT 'pending',
  assistance TEXT NOT NULL DEFAULT 'unknown',
  help_mask INTEGER NOT NULL DEFAULT 0,
  post_answer_help_mask INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  reveal_response_text TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  PRIMARY KEY(user_id,attempt_id)
);
CREATE INDEX task_evidence_item ON task_attempt_evidence(user_id,item_id,answered_at);
-- Defense in depth for account deletion through every existing profile removal path.
CREATE TRIGGER delete_profile_task_evidence AFTER DELETE ON profiles BEGIN
  DELETE FROM task_attempt_evidence WHERE user_id=OLD.user_id;
END;
