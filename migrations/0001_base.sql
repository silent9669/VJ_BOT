CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  track TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_lessons (
  lesson_id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  level TEXT NOT NULL,
  lesson INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT
);
CREATE TABLE IF NOT EXISTS curriculum_items (
  item_id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  book TEXT NOT NULL,
  level TEXT NOT NULL,
  lesson INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_type TEXT NOT NULL,
  order_num INTEGER NOT NULL,
  display TEXT NOT NULL,
  reading TEXT,
  meaning_vi TEXT,
  meaning_en TEXT,
  source_url TEXT
);
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  jlpt_level TEXT NOT NULL,
  correct INTEGER DEFAULT 0,
  incorrect INTEGER DEFAULT 0,
  last_reviewed TEXT,
  next_review TEXT,
  interval_days REAL DEFAULT 1.0,
  ease_factor REAL DEFAULT 2.5,
  UNIQUE(user_id, item_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL
);