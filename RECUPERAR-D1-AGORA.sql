-- Ronda Editorial 2.7.1 — recuperação imediata do D1 principal
-- Execute no Console do banco ronda-editorial-webapp-db caso ele já esteja no limite.
-- Mantém a ronda mais recente e o histórico leve; remove dados do YouTube do DB principal,
-- pois novas coletas passam a usar YOUTUBE_DB.

DELETE FROM youtube_collections;
DELETE FROM youtube_term_results;
DELETE FROM youtube_state;

UPDATE runs
SET payload_json = NULL
WHERE payload_json IS NOT NULL
  AND status NOT IN ('queued', 'running')
  AND id NOT IN (
    SELECT id
    FROM runs
    WHERE status = 'success' AND payload_json IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 12
  );

DELETE FROM runs
WHERE status NOT IN ('queued', 'running')
  AND id NOT IN (
    SELECT id
    FROM runs
    WHERE status NOT IN ('queued', 'running')
    ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(heartbeat_at, ''), NULLIF(started_at, ''), queued_at) DESC
    LIMIT 576
  );

DELETE FROM intelligent_carousels
WHERE cache_key NOT IN (
  SELECT cache_key FROM intelligent_carousels ORDER BY updated_at DESC LIMIT 60
);

DELETE FROM intelligent_jobs
WHERE job_id NOT IN (
  SELECT job_id FROM intelligent_jobs ORDER BY updated_at DESC LIMIT 120
);

DELETE FROM article_read_cache
WHERE cache_key NOT IN (
  SELECT cache_key FROM article_read_cache ORDER BY updated_at DESC LIMIT 40
);

DELETE FROM translation_cache
WHERE cache_key NOT IN (
  SELECT cache_key FROM translation_cache ORDER BY updated_at DESC LIMIT 1000
);

DELETE FROM locks
WHERE expires_at < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 300000;
