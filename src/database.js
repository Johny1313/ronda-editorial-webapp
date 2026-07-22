const initializedBindings = new WeakSet();

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runs (
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
  )`,
  "CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC)",
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

export async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' não configurado.");
  if (initializedBindings.has(db)) return;
  for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
  initializedBindings.add(db);
}

export async function acquireLock(db, name, ttlMs, nowMs = Date.now()) {
  await ensureSchema(db);
  const token = crypto.randomUUID();
  const expiresAt = nowMs + ttlMs;
  await db
    .prepare(`
      INSERT INTO locks (name, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE locks.expires_at < ?
    `)
    .bind(name, token, expiresAt, nowMs)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ?").bind(name).first();
  return row?.token === token ? { name, token, expiresAt } : null;
}

export async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}

export async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  const completedAt = payload.collectedAt || new Date().toISOString();
  const totals = payload.totals ?? {};
  const status = payload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(payload);
  const retentionCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const latestSummary = JSON.stringify({
    id,
    triggerType,
    status,
    completedAt,
    items: Number(totals.items) || 0,
    topics: Number(totals.topics) || 0,
    sources: Number(totals.sources) || 0,
  });

  await db.batch([
    db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        triggerType,
        status,
        startedAt,
        completedAt,
        Number(totals.items) || 0,
        Number(totals.topics) || 0,
        Number(totals.sources) || 0,
        Number(totals.socialItems) || 0,
        payload.error || null,
        payloadJson,
      ),
    db
      .prepare(`
        INSERT INTO app_state (key, value, updated_at) VALUES ('latest_run', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .bind(latestSummary, completedAt),
    db.prepare("DELETE FROM runs WHERE completed_at < ?").bind(retentionCutoff),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(Date.now() - 5 * 60 * 1000),
  ]);
  return { id, status, completedAt };
}

export async function getLatestRound(db) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1")
    .first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return { ...payload, runId: row.id, triggerType: row.trigger_type, storedAt: row.completed_at };
  } catch {
    throw new Error("A última ronda armazenada está corrompida.");
  }
}

export async function getRunHistory(db, limit = 30) {
  await ensureSchema(db);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs ORDER BY completed_at DESC LIMIT ?
    `)
    .bind(safeLimit)
    .all();
  return result?.results ?? [];
}

export async function databaseHealth(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT 1 AS ok").first();
  return Number(row?.ok) === 1;
}

export async function databaseSelfTest(db) {
  await ensureSchema(db);
  const id = `self-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let lock = null;
  try {
    await db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, 'self-test', 'self-test', ?, ?, 0, 0, 0, 0, NULL, NULL)
      `)
      .bind(id, now, now)
      .run();
    const written = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(id).first();
    lock = await acquireLock(db, `self-test-lock-${id}`, 10_000);
    return written?.id === id && Boolean(lock);
  } finally {
    await releaseLock(db, lock);
    await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  }
}
