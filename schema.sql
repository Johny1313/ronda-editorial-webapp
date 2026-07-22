CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  items_count INTEGER NOT NULL DEFAULT 0,
  topics_count INTEGER NOT NULL DEFAULT 0,
  sources_count INTEGER NOT NULL DEFAULT 0,
  social_items_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC);
CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
