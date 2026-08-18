-- Ronda Editorial v2.8.0 — curadoria de canais do YouTube
CREATE TABLE IF NOT EXISTS youtube_curated_channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  uploads_playlist_id TEXT NOT NULL,
  thumbnail_url TEXT,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_video_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_youtube_curated_active ON youtube_curated_channels(active, title);
