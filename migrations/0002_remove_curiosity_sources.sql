-- Ronda Editorial 2.5.1
-- Remove estados operacionais de canais retirados do catálogo.

DELETE FROM source_state
WHERE source_id IN (
  'fatos-desconhecidos',
  'mega-curioso',
  'incrivel-club',
  'misterios-do-mundo',
  'canaltech-curiosidades',
  'superinteressante',
  'revista-galileu',
  'segredos-do-mundo',
  'awebic',
  'hypeness'
);

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.5.1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
