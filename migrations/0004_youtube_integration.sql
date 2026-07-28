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

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.6.0', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
