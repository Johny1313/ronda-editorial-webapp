-- Ronda Editorial 2.7.0
-- Perfis editoriais, autenticação por e-mail e biblioteca compacta de exemplos de escrita.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  default_slide_count INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email_key ON users(email_key);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS writing_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_writing_samples_user ON writing_samples(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS writing_profiles (
  user_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP;

INSERT INTO app_state (key, value, updated_at)
VALUES ('schema_version', '2.7.0', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
