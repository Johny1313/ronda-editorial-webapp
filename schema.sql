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
CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_run_topic ON intelligent_carousels(run_id, topic_id);
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
CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_job_id ON intelligent_jobs(job_id);
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
CREATE INDEX IF NOT EXISTS idx_article_source_stats_updated ON article_source_stats(updated_at DESC);

CREATE TABLE IF NOT EXISTS custom_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_sources_active_name ON custom_sources(active, name);

CREATE TABLE IF NOT EXISTS monitoring_terms (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  term_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitoring_terms_active_term ON monitoring_terms(active, term);
