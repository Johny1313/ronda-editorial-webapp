-- Ronda Editorial v2.5.2
-- Corrige o ciclo queued -> running -> success/failed/expired.

DROP TABLE IF EXISTS runs_v252;
CREATE TABLE runs_v252 (
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

INSERT INTO runs_v252 (
  id, trigger_type, status, queued_at, started_at, heartbeat_at, completed_at,
  items_count, topics_count, sources_count, social_items_count, error, payload_json
)
SELECT
  id,
  trigger_type,
  status,
  COALESCE(NULLIF(started_at, ''), NULLIF(completed_at, ''), CURRENT_TIMESTAMP),
  CASE WHEN status IN ('running', 'success', 'failed') THEN NULLIF(started_at, '') ELSE NULL END,
  COALESCE(NULLIF(started_at, ''), NULLIF(completed_at, ''), CURRENT_TIMESTAMP),
  CASE WHEN status IN ('success', 'failed') THEN NULLIF(completed_at, '') ELSE NULL END,
  items_count,
  topics_count,
  sources_count,
  social_items_count,
  error,
  payload_json
FROM runs;

DROP INDEX IF EXISTS idx_runs_completed;
DROP INDEX IF EXISTS idx_runs_status_completed;
DROP INDEX IF EXISTS idx_runs_status_activity;
DROP TABLE runs;
ALTER TABLE runs_v252 RENAME TO runs;

CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_activity ON runs(status, heartbeat_at DESC, queued_at DESC);

UPDATE runs
SET
  status = 'expired',
  completed_at = CURRENT_TIMESTAMP,
  heartbeat_at = CURRENT_TIMESTAMP,
  error = CASE
    WHEN status = 'queued' THEN 'Ronda antiga expirada antes de iniciar no consumidor.'
    ELSE 'Ronda antiga expirada por ausência de progresso.'
  END
WHERE status IN ('queued', 'running')
  AND datetime(COALESCE(heartbeat_at, started_at, queued_at)) < datetime('now', '-10 minutes');

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.5.2', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
