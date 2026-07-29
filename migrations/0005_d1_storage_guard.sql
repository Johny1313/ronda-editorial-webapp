-- Ronda Editorial 2.6.1
-- Limpa snapshots volumosos e limita o histórico armazenado no mesmo D1.

DELETE FROM youtube_collections
WHERE id NOT IN (
  SELECT id
  FROM youtube_collections
  ORDER BY completed_at DESC
  LIMIT 48
);

DELETE FROM youtube_term_results
WHERE id NOT IN (
  SELECT id
  FROM youtube_term_results
  ORDER BY collected_at DESC
  LIMIT 24
);

DELETE FROM runs
WHERE status NOT IN ('queued', 'running')
  AND id NOT IN (
    SELECT id
    FROM runs
    WHERE status NOT IN ('queued', 'running')
    ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC
    LIMIT 288
  );

DELETE FROM intelligent_carousels
WHERE expires_at < CURRENT_TIMESTAMP;

DELETE FROM intelligent_jobs
WHERE expires_at < CURRENT_TIMESTAMP;

DELETE FROM article_read_cache
WHERE expires_at < CURRENT_TIMESTAMP;

DELETE FROM translation_cache
WHERE updated_at < datetime('now', '-14 days');

DELETE FROM locks
WHERE expires_at < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 300000;

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.6.1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
