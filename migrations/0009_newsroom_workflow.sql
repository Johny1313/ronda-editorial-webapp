-- Ronda Editorial v2.8.0 — fluxo de redação e pautas persistentes

CREATE TABLE IF NOT EXISTS newsroom_stories (
  id TEXT PRIMARY KEY,
  topic_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  editoria TEXT NOT NULL,
  priority TEXT NOT NULL,
  editorial_queue TEXT NOT NULL DEFAULT 'watch',
  workflow_status TEXT NOT NULL DEFAULT 'discovered',
  score INTEGER NOT NULL DEFAULT 0,
  assignee_user_id TEXT,
  verification_level TEXT NOT NULL DEFAULT 'single',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  latest_run_id TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  change_summary_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_newsroom_stories_queue ON newsroom_stories(editorial_queue, last_changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsroom_stories_status ON newsroom_stories(workflow_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsroom_stories_assignee ON newsroom_stories(assignee_user_id, workflow_status);

CREATE TABLE IF NOT EXISTS newsroom_story_events (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_newsroom_story_events_story ON newsroom_story_events(story_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsroom_story_events_created ON newsroom_story_events(created_at DESC);

CREATE TABLE IF NOT EXISTS newsroom_story_notes (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_newsroom_story_notes_story ON newsroom_story_notes(story_id, created_at DESC);

CREATE TABLE IF NOT EXISTS newsroom_story_followers (
  story_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(story_id, user_id)
);
