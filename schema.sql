CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  completed_at TEXT,
  items_count INTEGER NOT NULL DEFAULT 0,
  topics_count INTEGER NOT NULL DEFAULT 0,
  sources_count INTEGER NOT NULL DEFAULT 0,
  social_items_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_activity ON runs(status, heartbeat_at DESC, queued_at DESC);
CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key TEXT PRIMARY KEY,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC);
CREATE TABLE IF NOT EXISTS intelligent_carousels (
  cache_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_expires ON intelligent_carousels(expires_at);
CREATE TABLE IF NOT EXISTS intelligent_jobs (
  cache_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_expires ON intelligent_jobs(expires_at);
CREATE TABLE IF NOT EXISTS article_read_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_article_read_cache_expires ON article_read_cache(expires_at);
CREATE TABLE IF NOT EXISTS article_source_stats (
  hostname TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  total_words INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitoring_terms (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  term_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitoring_terms_active_term ON monitoring_terms(active, term);
CREATE TABLE IF NOT EXISTS source_state (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL,
  route TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT,
  error_detail TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_url TEXT,
  validators_json TEXT NOT NULL DEFAULT '{}',
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  response_ms INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_state_next_check ON source_state(next_check_at);
CREATE INDEX IF NOT EXISTS idx_source_state_status ON source_state(status, updated_at DESC);
DROP INDEX IF EXISTS idx_intelligent_carousels_run_topic;
DROP INDEX IF EXISTS idx_intelligent_jobs_job_id;
DROP INDEX IF EXISTS idx_article_source_stats_updated;
INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.5.2', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

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
VALUES ('schema_version', '2.6.1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
