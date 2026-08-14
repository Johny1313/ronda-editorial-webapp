CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_collections (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  region TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_youtube_collections_completed ON youtube_collections(completed_at DESC);

CREATE TABLE IF NOT EXISTS youtube_term_results (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL,
  term TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_term_results_term ON youtube_term_results(term_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS youtube_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

