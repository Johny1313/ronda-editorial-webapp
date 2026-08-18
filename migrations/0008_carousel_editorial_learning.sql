-- Ronda Editorial 2.7.8
-- Memória editorial adaptativa baseada somente em carrosséis aprovados/editados pelo usuário.

CREATE TABLE IF NOT EXISTS carousel_learning_examples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  slide_count INTEGER NOT NULL,
  slides_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_carousel_learning_user ON carousel_learning_examples(user_id, created_at DESC);

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.7.8', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
