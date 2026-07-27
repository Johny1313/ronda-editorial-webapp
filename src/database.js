const initializedBindings = new WeakSet();
export const MAX_MONITORING_TERMS = 6;
export const DATABASE_SCHEMA_VERSION = "2.5.1";

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
  `CREATE TABLE IF NOT EXISTS translation_cache (
    cache_key TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS intelligent_carousels (
    cache_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_expires ON intelligent_carousels(expires_at)",
  `CREATE TABLE IF NOT EXISTS intelligent_jobs (
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
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_expires ON intelligent_jobs(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_read_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_article_read_cache_expires ON article_read_cache(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_source_stats (
    hostname TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    total_words INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS monitoring_terms (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    term_key TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_monitoring_terms_active_term ON monitoring_terms(active, term)",
  `CREATE TABLE IF NOT EXISTS source_state (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    route TEXT NOT NULL,
    http_status INTEGER,
    error_code TEXT,
    error_detail TEXT,
    items_json TEXT NOT NULL DEFAULT '[]',
    item_count INTEGER NOT NULL DEFAULT 0,
    last_url TEXT,
    validators_json TEXT NOT NULL DEFAULT '{}',
    last_attempt_at TEXT,
    last_success_at TEXT,
    next_check_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    response_ms INTEGER,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_source_state_next_check ON source_state(next_check_at)",
  "CREATE INDEX IF NOT EXISTS idx_source_state_status ON source_state(status, updated_at DESC)",
  `DELETE FROM source_state WHERE source_id IN (
    'fatos-desconhecidos', 'mega-curioso', 'incrivel-club', 'misterios-do-mundo',
    'canaltech-curiosidades', 'superinteressante', 'revista-galileu',
    'segredos-do-mundo', 'awebic', 'hypeness'
  )`,
];

async function currentSchemaVersion(db) {
  try {
    const row = await db.prepare("SELECT value FROM app_state WHERE key = 'schema_version' LIMIT 1").first();
    return String(row?.value || "");
  } catch {
    return "";
  }
}

export async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' não configurado.");
  if (initializedBindings.has(db)) return;
  const version = await currentSchemaVersion(db);
  if (version !== DATABASE_SCHEMA_VERSION) {
    for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('schema_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(DATABASE_SCHEMA_VERSION, now).run();
  }
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

export async function renewLock(db, lock, ttlMs, nowMs = Date.now()) {
  if (!db || !lock) return null;
  const expiresAt = nowMs + Math.max(1_000, Number(ttlMs) || 1_000);
  await db.prepare("UPDATE locks SET expires_at = ? WHERE name = ? AND token = ?")
    .bind(expiresAt, lock.name, lock.token)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ? LIMIT 1").bind(lock.name).first();
  if (row?.token !== lock.token) return null;
  lock.expiresAt = Number(row.expires_at) || expiresAt;
  return lock;
}

export async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}


function monitoringTermRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monitoringTermKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}


export async function listMonitoringTerms(db, { activeOnly = false } = {}) {
  await ensureSchema(db);
  const result = await db
    .prepare(`SELECT * FROM monitoring_terms ${activeOnly ? "WHERE active = 1" : ""} ORDER BY active DESC, term COLLATE NOCASE`)
    .all();
  return (result?.results || []).map(monitoringTermRow);
}

export async function createMonitoringTerm(db, term) {
  await ensureSchema(db);
  const termKey = monitoringTermKey(term);
  const existing = await db.prepare("SELECT id FROM monitoring_terms WHERE term_key = ? LIMIT 1").bind(termKey).first();
  if (existing) throw new Error("Este termo já está cadastrado.");
  const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
  if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO monitoring_terms (id, term, term_key, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(id, term, termKey, now, now).run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

export async function setMonitoringTermActive(db, id, active) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  if (active && Number(current.active) !== 1) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
    if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  }
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE monitoring_terms SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, updatedAt, id)
    .run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

export async function deleteMonitoringTerm(db, id) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  await db.prepare("DELETE FROM monitoring_terms WHERE id = ?").bind(id).run();
  return monitoringTermRow(current);
}

export async function startRun(db, { id, triggerType, startedAt }) {
  await ensureSchema(db);
  await db
    .prepare(`
      INSERT INTO runs (
        id, trigger_type, status, started_at, completed_at,
        items_count, topics_count, sources_count, social_items_count,
        error, payload_json
      ) VALUES (?, ?, 'running', ?, ?, 0, 0, 0, 0, NULL, NULL)
    `)
    .bind(id, triggerType, startedAt, startedAt)
    .run();
  return { id, status: "running", startedAt };
}

export async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {
        ok: false,
        collectedAt: new Date().toISOString(),
        error: "A coleta terminou sem retornar dados válidos.",
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
      };
  const completedAt = safePayload.collectedAt || new Date().toISOString();
  const totals = safePayload.totals ?? {};
  const status = safePayload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(safePayload);
  await db.batch([
    db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          trigger_type = excluded.trigger_type,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          items_count = excluded.items_count,
          topics_count = excluded.topics_count,
          sources_count = excluded.sources_count,
          social_items_count = excluded.social_items_count,
          error = excluded.error,
          payload_json = excluded.payload_json
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
        safePayload.error || null,
        payloadJson,
      ),
  ]);
  return { id, status, completedAt };
}

export async function getCachedTranslations(db, keys = []) {
  await ensureSchema(db);
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT cache_key, translated_text FROM translation_cache WHERE cache_key IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      if (row?.cache_key && row?.translated_text) output.set(row.cache_key, row.translated_text);
    }
  }
  return output;
}

export async function saveCachedTranslations(db, entries = []) {
  await ensureSchema(db);
  const validEntries = entries.filter((entry) => entry?.key && entry?.translatedText);
  const updatedAt = new Date().toISOString();
  for (let offset = 0; offset < validEntries.length; offset += 80) {
    const chunk = validEntries.slice(offset, offset + 80);
    await db.batch(chunk.map((entry) => db
      .prepare(`
        INSERT INTO translation_cache (cache_key, source_lang, target_lang, translated_text, updated_at)
        VALUES (?, ?, 'pt', ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          translated_text = excluded.translated_text,
          updated_at = excluded.updated_at
      `)
      .bind(entry.key, entry.sourceLanguage, entry.translatedText, updatedAt)));
  }
}

export async function getLatestRound(db) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1")
    .first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
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

export async function getRunStatus(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  return row ?? null;
}

export async function getRunPayload(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at, error, payload_json
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error("Os dados desta ronda estão corrompidos.");
    }
  }
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    payload,
  };
}

export async function getArticleReadCache(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM article_read_cache WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function saveArticleReadCache(db, cacheKey, payload, ttlHours = 12) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 12) * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO article_read_cache (cache_key, payload_json, updated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(cacheKey, JSON.stringify(payload), updatedAt, expiresAt).run();
  return { updatedAt, expiresAt };
}

function hostnameFromUrl(value) {
  try { return new URL(String(value || "")).hostname.toLocaleLowerCase("pt-BR").replace(/^www\./, ""); } catch { return ""; }
}

export async function getArticleSourceStats(db, urls = []) {
  await ensureSchema(db);
  const hostnames = [...new Set(urls.map(hostnameFromUrl).filter(Boolean))];
  if (!hostnames.length) return {};
  const output = {};
  for (let offset = 0; offset < hostnames.length; offset += 80) {
    const chunk = hostnames.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT hostname, attempts, successes, total_words, updated_at FROM article_source_stats WHERE hostname IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      output[row.hostname] = {
        attempts: Number(row.attempts) || 0,
        successes: Number(row.successes) || 0,
        totalWords: Number(row.total_words) || 0,
        updatedAt: row.updated_at,
      };
    }
  }
  return output;
}

export async function recordArticleSourceAttempt(db, { url, success, wordCount = 0 } = {}) {
  await ensureSchema(db);
  const hostname = hostnameFromUrl(url);
  if (!hostname) return null;
  const updatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO article_source_stats (hostname, attempts, successes, total_words, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      attempts = article_source_stats.attempts + 1,
      successes = article_source_stats.successes + excluded.successes,
      total_words = article_source_stats.total_words + excluded.total_words,
      updated_at = excluded.updated_at
  `).bind(hostname, success ? 1 : 0, Math.max(0, Number(wordCount) || 0), updatedAt).run();
  return { hostname, updatedAt };
}


export async function getIntelligentCarousel(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM intelligent_carousels WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function saveIntelligentCarousel(db, { cacheKey, runId, topicId, payload, ttlHours = 48 }) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 48) * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`
      INSERT INTO intelligent_carousels (cache_key, run_id, topic_id, payload_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        run_id = excluded.run_id,
        topic_id = excluded.topic_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    .bind(cacheKey, runId, topicId, JSON.stringify(payload), updatedAt, expiresAt)
    .run();
  return { updatedAt, expiresAt };
}


function parseIntelligentJob(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch {}
  }
  const updatedAt = row.updated_at || row.created_at;
  const active = row.status === "queued" || row.status === "running";
  return {
    cacheKey: row.cache_key,
    jobId: row.job_id,
    runId: row.run_id,
    topicId: row.topic_id,
    status: row.status,
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    message: row.message || "",
    error: row.error || null,
    payload,
    createdAt: row.created_at,
    updatedAt,
    expiresAt: row.expires_at,
    stale: active && Date.now() - Date.parse(updatedAt) > 10 * 60 * 1000,
  };
}

export async function getIntelligentJob(db, jobId) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE job_id = ? LIMIT 1")
    .bind(jobId)
    .first();
  return parseIntelligentJob(row);
}

export async function createIntelligentJob(db, {
  cacheKey,
  runId,
  topicId,
  staleMs = 10 * 60 * 1000,
  ttlMinutes = 120,
  replaceCompleted = false,
} = {}) {
  await ensureSchema(db);
  const existingRow = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  const existing = parseIntelligentJob(existingRow);
  const existingAge = existing?.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : Number.POSITIVE_INFINITY;
  if (existing && (
    (["queued", "running"].includes(existing.status) && existingAge <= staleMs)
    || (!replaceCompleted && existing.status === "succeeded" && existing.payload)
  )) {
    return { created: false, job: existing };
  }

  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO intelligent_jobs (
      cache_key, job_id, run_id, topic_id, status, progress, message, error,
      payload_json, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, 'queued', 1, ?, NULL, NULL, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      job_id = excluded.job_id,
      run_id = excluded.run_id,
      topic_id = excluded.topic_id,
      status = excluded.status,
      progress = excluded.progress,
      message = excluded.message,
      error = NULL,
      payload_json = NULL,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(cacheKey, jobId, runId, topicId, "Leitura adicionada à fila.", now, now, expiresAt).run();
  return {
    created: true,
    job: {
      cacheKey,
      jobId,
      runId,
      topicId,
      status: "queued",
      progress: 1,
      message: "Leitura adicionada à fila.",
      error: null,
      payload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      stale: false,
    },
  };
}

export async function updateIntelligentJob(db, {
  jobId,
  status,
  progress = 0,
  message = "",
  error = null,
  payload = null,
  ttlMinutes = 120,
} = {}) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    UPDATE intelligent_jobs
    SET status = ?, progress = ?, message = ?, error = ?, payload_json = ?, updated_at = ?, expires_at = ?
    WHERE job_id = ?
  `).bind(
    status,
    Math.max(0, Math.min(100, Number(progress) || 0)),
    message || "",
    error ? String(error).slice(0, 300) : null,
    payload ? JSON.stringify(payload) : null,
    updatedAt,
    expiresAt,
    jobId,
  ).run();
  return getIntelligentJob(db, jobId);
}


function parseJsonObject(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sourceStateRow(row) {
  if (!row) return null;
  return {
    sourceId: row.source_id,
    name: row.name,
    region: row.region,
    status: row.status,
    route: row.route,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    errorCode: row.error_code || null,
    errorDetail: row.error_detail || null,
    items: Array.isArray(parseJsonObject(row.items_json, [])) ? parseJsonObject(row.items_json, []) : [],
    itemCount: Number(row.item_count) || 0,
    lastUrl: row.last_url || null,
    validators: parseJsonObject(row.validators_json, {}),
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextCheckAt: row.next_check_at || null,
    failureCount: Number(row.failure_count) || 0,
    responseMs: row.response_ms == null ? null : Number(row.response_ms),
    updatedAt: row.updated_at,
  };
}

export async function getSourceStates(db, sourceIds = []) {
  await ensureSchema(db);
  const ids = [...new Set(sourceIds.map((value) => String(value || "").trim()).filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db.prepare(`SELECT * FROM source_state WHERE source_id IN (${placeholders})`).bind(...chunk).all();
    for (const row of result?.results || []) {
      const parsed = sourceStateRow(row);
      if (parsed) output.set(parsed.sourceId, parsed);
    }
  }
  return output;
}

export async function saveSourceStates(db, entries = []) {
  await ensureSchema(db);
  const valid = entries.filter((entry) => entry?.sourceId && entry?.name);
  if (!valid.length) return 0;
  for (let offset = 0; offset < valid.length; offset += 40) {
    const chunk = valid.slice(offset, offset + 40);
    await db.batch(chunk.map((entry) => db.prepare(`
      INSERT INTO source_state (
        source_id, name, region, status, route, http_status, error_code, error_detail,
        items_json, item_count, last_url, validators_json, last_attempt_at, last_success_at,
        next_check_at, failure_count, response_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        name = excluded.name,
        region = excluded.region,
        status = excluded.status,
        route = excluded.route,
        http_status = excluded.http_status,
        error_code = excluded.error_code,
        error_detail = excluded.error_detail,
        items_json = excluded.items_json,
        item_count = excluded.item_count,
        last_url = excluded.last_url,
        validators_json = excluded.validators_json,
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        next_check_at = excluded.next_check_at,
        failure_count = excluded.failure_count,
        response_ms = excluded.response_ms,
        updated_at = excluded.updated_at
    `).bind(
      entry.sourceId,
      entry.name,
      entry.region || "Brasil",
      entry.status || "unknown",
      entry.route || "unknown",
      entry.httpStatus ?? null,
      entry.errorCode || null,
      entry.errorDetail ? String(entry.errorDetail).slice(0, 300) : null,
      JSON.stringify(Array.isArray(entry.items) ? entry.items : []),
      Number(entry.itemCount) || 0,
      entry.lastUrl || null,
      JSON.stringify(entry.validators && typeof entry.validators === "object" ? entry.validators : {}),
      entry.lastAttemptAt || null,
      entry.lastSuccessAt || null,
      entry.nextCheckAt || null,
      Number(entry.failureCount) || 0,
      entry.responseMs == null ? null : Math.max(0, Number(entry.responseMs) || 0),
      entry.updatedAt || new Date().toISOString(),
    )));
  }
  return valid.length;
}

export async function listSourceDiagnostics(db) {
  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT source_id, name, region, status, route, http_status, error_code, error_detail,
           item_count, last_attempt_at, last_success_at, next_check_at, failure_count,
           response_ms, updated_at
    FROM source_state
    ORDER BY region, name COLLATE NOCASE
  `).all();
  return (result?.results || []).map((row) => ({
    sourceId: row.source_id,
    name: row.name,
    region: row.region,
    status: row.status,
    route: row.route,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    errorCode: row.error_code || null,
    errorDetail: row.error_detail || null,
    itemCount: Number(row.item_count) || 0,
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextCheckAt: row.next_check_at || null,
    failureCount: Number(row.failure_count) || 0,
    responseMs: row.response_ms == null ? null : Number(row.response_ms),
    updatedAt: row.updated_at,
  }));
}

export async function getLatestRunSummary(db, { successOnly = false } = {}) {
  await ensureSchema(db);
  const row = await db.prepare(`
    SELECT id, trigger_type, status, started_at, completed_at,
           items_count, topics_count, sources_count, social_items_count, error
    FROM runs
    ${successOnly ? "WHERE status = 'success'" : ""}
    ORDER BY completed_at DESC
    LIMIT 1
  `).first();
  if (!row) return null;
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    items: Number(row.items_count) || 0,
    topics: Number(row.topics_count) || 0,
    sources: Number(row.sources_count) || 0,
    socialItems: Number(row.social_items_count) || 0,
    error: row.error || null,
  };
}

export async function runDatabaseMaintenance(db, { intervalHours = 12 } = {}) {
  await ensureSchema(db);
  const nowMs = Date.now();
  const row = await db.prepare("SELECT value FROM app_state WHERE key = 'last_maintenance_at' LIMIT 1").first();
  const lastMs = Date.parse(row?.value || "");
  if (Number.isFinite(lastMs) && nowMs - lastMs < Math.max(1, Number(intervalHours) || 12) * 60 * 60 * 1000) return false;
  const now = new Date(nowMs).toISOString();
  const retentionCutoff = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();
  const translationCutoff = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM runs WHERE completed_at < ?").bind(retentionCutoff),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(nowMs - 5 * 60 * 1000),
    db.prepare("DELETE FROM translation_cache WHERE updated_at < ?").bind(translationCutoff),
    db.prepare("DELETE FROM intelligent_carousels WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM intelligent_jobs WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM article_read_cache WHERE expires_at < ?").bind(now),
    db.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_maintenance_at', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(now, now),
  ]);
  return true;
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
