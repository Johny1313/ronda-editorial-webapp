// src/parser.js
var NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "\u2026",
  laquo: "\xAB",
  ldquo: "\u201C",
  lsquo: "\u2018",
  lt: "<",
  nbsp: " ",
  quot: '"',
  raquo: "\xBB",
  rdquo: "\u201D",
  rsquo: "\u2019"
});
function decodeEntities(value = "") {
  return String(value).replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16))).replace(/&#([0-9]+);/g, (_, decimal) => safeCodePoint(Number.parseInt(decimal, 10))).replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}
function safeCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}
function plainText(value = "") {
  return decodeEntities(
    String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tagValue(block, names) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const expression = new RegExp(
      `<(?:[a-z0-9_-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${escaped}\\s*>`,
      "i"
    );
    const match = expression.exec(block);
    const text = match ? plainText(match[1]) : "";
    if (text) return text;
  }
  return "";
}
function attributeValue(attributes, name) {
  const match = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes);
  return match ? decodeEntities(match[2]).trim() : "";
}
function linkValue(block) {
  const candidates = [];
  const paired = /<(?:[a-z0-9_-]+:)?link\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?link\s*>/gi;
  const selfClosing = /<(?:[a-z0-9_-]+:)?link\b([^>]*?)\/?\s*>/gi;
  let match;
  while (match = paired.exec(block)) {
    candidates.push({
      href: attributeValue(match[1], "href") || plainText(match[2]),
      rel: attributeValue(match[1], "rel")
    });
  }
  while (match = selfClosing.exec(block)) {
    const href = attributeValue(match[1], "href");
    if (href) candidates.push({ href, rel: attributeValue(match[1], "rel") });
  }
  const preferred = candidates.find((candidate) => !candidate.rel || candidate.rel === "alternate") ?? candidates[0];
  if (preferred?.href) return preferred.href;
  const guid = tagValue(block, ["guid", "id"]);
  return /^https?:\/\//i.test(guid) ? guid : "";
}
function stableHash(value = "") {
  let first = 2166136261;
  let second = 2654435769;
  for (const character of String(value)) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + (second << 6 >>> 0) + (second >>> 2);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
function isoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
function parseFeed(xmlText, feed, cutoff = new Date(Date.now() - 24 * 60 * 60 * 1e3), limit = 40) {
  const xml = String(xmlText ?? "").slice(0, 3e6);
  const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff);
  const now = Date.now() + 5 * 60 * 1e3;
  const blocks = [];
  const itemExpression = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const entryExpression = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi;
  let match;
  while ((match = itemExpression.exec(xml)) && blocks.length < limit * 2) blocks.push(match[1]);
  if (!blocks.length) {
    while ((match = entryExpression.exec(xml)) && blocks.length < limit * 2) blocks.push(match[1]);
  }
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const block of blocks) {
    if (result.length >= limit) break;
    const title = tagValue(block, ["title"]);
    const description = tagValue(block, ["description", "summary", "encoded", "content"]);
    const publishedAt = isoDate(tagValue(block, ["pubDate", "published", "updated", "date"]));
    const url = linkValue(block);
    const timestamp = Date.parse(publishedAt);
    if (!title || !url || !publishedAt || !/^https?:\/\//i.test(url)) continue;
    if (!Number.isFinite(timestamp) || timestamp < cutoffTime || timestamp > now || seen.has(url)) continue;
    seen.add(url);
    const declaredSource = tagValue(block, ["source"]);
    result.push({
      id: `rss-${feed.id}-${stableHash(url)}`,
      title,
      description: description.slice(0, 280),
      sourceName: declaredSource || feed.name,
      collectorName: feed.name,
      platform: "Portal",
      kind: "portal",
      publishedAt,
      url,
      views: null,
      comments: null,
      likes: null,
      interactions: null
    });
  }
  return result;
}

// src/clustering.js
var STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "entre",
  "foi",
  "ha",
  "mais",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "por",
  "que",
  "se",
  "sem",
  "ser",
  "sob",
  "sobre",
  "um",
  "uma",
  "vai",
  "apos",
  "ante",
  "ate",
  "contra",
  "durante",
  "noticia",
  "noticias",
  "hoje",
  "veja",
  "diz",
  "afirma",
  "novo",
  "nova",
  "brasil",
  "brasileiro",
  "brasileira"
]);
function normalizeText(value = "") {
  return plainText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function titleTokens(title) {
  const output = [];
  const seen = /* @__PURE__ */ new Set();
  for (const token of normalizeText(title).split(/\s+/)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
    if (output.length >= 14) break;
  }
  return output;
}
function tokenSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) if (rightSet.has(token)) overlap += 1;
  if (!overlap) return 0;
  const union = leftSet.size + rightSet.size - overlap;
  const minimum = Math.min(leftSet.size, rightSet.size);
  const jaccard = overlap / union;
  const containment = overlap / minimum;
  const bonus = overlap >= 3 ? 0.2 : overlap >= 2 ? 0.08 : 0;
  return Math.min(1, jaccard * 0.55 + containment * 0.45 + bonus);
}
function clusterItems(items, threshold = 0.36) {
  const clusters = [];
  const ordered = [...items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  for (const item of ordered) {
    const tokens = titleTokens(item.title);
    if (!tokens.length) continue;
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = tokenSimilarity(tokens, cluster.tokens);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best && bestScore >= threshold) {
      best.items.push(item);
      best.tokens = [.../* @__PURE__ */ new Set([...best.tokens, ...tokens])].slice(0, 18);
    } else {
      clusters.push({ tokens, items: [item] });
    }
  }
  return clusters;
}
function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function clusterToTopic(cluster, now = /* @__PURE__ */ new Date()) {
  const items = [...cluster.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const representative = items.find((item) => item.kind === "portal") ?? items[0];
  const sourceNames = [...new Set(items.map((item) => item.sourceName).filter(Boolean))];
  const portalCount = items.filter((item) => item.kind === "portal").length;
  const socialCount = items.length - portalCount;
  const comments = items.reduce((sum, item) => sum + positiveNumber(item.comments), 0);
  const interactions = items.reduce((sum, item) => sum + positiveNumber(item.interactions), 0);
  const views = items.reduce((sum, item) => sum + positiveNumber(item.views), 0);
  const lastPublishedAt = items[0]?.publishedAt ?? now.toISOString();
  const ageHours = Math.max(0, (now.getTime() - Date.parse(lastPublishedAt)) / 36e5);
  const channelFactor = Math.min(1, sourceNames.length / 5);
  const volumeFactor = Math.min(1, items.length / 8);
  const socialFactor = Math.min(1, Math.log10(interactions + 1) / 4);
  const freshnessFactor = Math.exp(-ageHours / 6);
  const score = Math.max(1, Math.min(100, Math.round(channelFactor * 35 + volumeFactor * 30 + socialFactor * 20 + freshnessFactor * 15)));
  const tone = score >= 70 ? "urgent" : score >= 45 ? "watch" : "neutral";
  const priority = score >= 70 ? "Pautar agora" : score >= 45 ? "Acompanhar" : "Em observa\xE7\xE3o";
  const momentum = sourceNames.length >= 3 ? `${sourceNames.length} fontes publicaram sobre o assunto` : items.length >= 2 ? `${items.length} conte\xFAdos relacionados` : "Assunto rec\xE9m-detectado";
  const recommendation = sourceNames.length >= 3 ? "Confirmar os fatos nas fontes originais e preparar uma abordagem pr\xF3pria." : socialCount > 0 ? "Checar se a repercuss\xE3o social cresce antes de priorizar a pauta." : "Acompanhar novas publica\xE7\xF5es e buscar uma segunda fonte independente.";
  return {
    id: `topic-${stableHash(cluster.tokens.slice(0, 6).join("-"))}`,
    title: representative?.title ?? "Assunto sem t\xEDtulo",
    priority,
    tone,
    score,
    lastPublishedAt,
    sourceNames,
    sourceCount: sourceNames.length,
    itemCount: items.length,
    portalCount,
    socialCount,
    views: views || null,
    comments: comments || null,
    interactions: interactions || null,
    momentum,
    recommendation,
    items
  };
}
function buildTopics(items, now = /* @__PURE__ */ new Date(), limit = 40) {
  return clusterItems(items).map((cluster) => clusterToTopic(cluster, now)).sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt)).slice(0, limit);
}

// src/collector.js
var FEEDS = Object.freeze([
  {
    id: "g1",
    name: "G1",
    urls: [
      "https://g1.globo.com/rss/g1/",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AG1&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "folha",
    name: "Folha de S.Paulo",
    urls: [
      "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AFolha_de_S.Paulo&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "uol",
    name: "UOL",
    urls: [
      "https://rss.uol.com.br/feed/noticias.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AUOL&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "estadao",
    name: "Estad\xE3o",
    urls: [
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AEstad%C3%A3o&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
      "https://news.google.com/rss/search?q=when%3A1d%20Estad%C3%A3o&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "agencia-brasil",
    name: "Ag\xEAncia Brasil",
    urls: [
      "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AAg%C3%AAncia_Brasil&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "bbc-brasil",
    name: "BBC News Brasil",
    urls: [
      "https://feeds.bbci.co.uk/portuguese/rss.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3ABBC_News_Brasil&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"
    ]
  },
  {
    id: "outros-portais",
    name: "Outros portais",
    urls: ["https://news.google.com/rss/search?q=when%3A1d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"]
  }
]);
function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  return message.replace(/\s+/g, " ").trim().slice(0, 150);
}
async function fetchWithTimeout(url, fetcher, { accept, timeoutMs = 12e3 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite excedido"), timeoutMs);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
async function collectFeed(feed, cutoff, fetcher = fetch) {
  const errors = [];
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      const response = await fetchWithTimeout(url, fetcher);
      const xml = await response.text();
      const items = parseFeed(xml, feed, cutoff, 35);
      if (!items.length) throw new Error("Feed sem conte\xFAdo v\xE1lido nas \xFAltimas 24 horas");
      return {
        items,
        status: {
          id: feed.id,
          name: feed.name,
          ok: true,
          count: items.length,
          error: null,
          fallback: index > 0
        }
      };
    } catch (error) {
      errors.push(compactError(error));
    }
  }
  return {
    items: [],
    status: {
      id: feed.id,
      name: feed.name,
      ok: false,
      count: 0,
      error: [...new Set(errors)].slice(0, 2).join(" | ") || "Fonte indispon\xEDvel",
      fallback: false
    }
  };
}
function uniqueItems(items, limit = Number.POSITIVE_INFINITY) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
function positiveNumber2(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function blueskyItem(post, cutoff) {
  const text = plainText(post?.record?.text);
  const publishedAtValue = post?.record?.createdAt || post?.indexedAt;
  const timestamp = Date.parse(publishedAtValue);
  const handle = plainText(post?.author?.handle);
  const rkey = String(post?.uri ?? "").split("/").filter(Boolean).at(-1);
  if (!text || !handle || !rkey || !Number.isFinite(timestamp) || timestamp < cutoff.getTime()) return null;
  const comments = positiveNumber2(post.replyCount);
  const likes = positiveNumber2(post.likeCount);
  const reposts = positiveNumber2(post.repostCount);
  const quotes = positiveNumber2(post.quoteCount);
  return {
    id: `bsky-${stableHash(post.uri)}`,
    title: text.slice(0, 210),
    description: "",
    sourceName: plainText(post?.author?.displayName) || `@${handle}`,
    collectorName: "Bluesky",
    platform: "Bluesky",
    kind: "social",
    publishedAt: new Date(timestamp).toISOString(),
    url: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`,
    views: null,
    comments,
    likes,
    interactions: comments + likes + reposts + quotes
  };
}
async function collectBluesky(initialClusters, cutoff, fetcher = fetch) {
  const queries = [];
  for (const cluster of initialClusters.slice(0, 5)) {
    const first = cluster.items[0];
    const query = titleTokens(first?.title ?? "").slice(0, 3).join(" ");
    if (query && !queries.includes(query)) queries.push(query);
  }
  if (!queries.length) {
    return { items: [], status: { id: "bluesky", name: "Bluesky", ok: true, count: 0, error: null, fallback: false } };
  }
  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=8&sort=latest`;
      const response = await fetchWithTimeout(endpoint, fetcher, { accept: "application/json", timeoutMs: 12e3 });
      const payload = await response.json();
      return Array.isArray(payload?.posts) ? payload.posts : [];
    })
  );
  const items = [];
  const errors = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(compactError(result.reason));
      continue;
    }
    for (const post of result.value) {
      const item = blueskyItem(post, cutoff);
      if (item) items.push(item);
    }
  }
  const unique = uniqueItems(items, 35);
  const allFailed = results.length > 0 && results.every((result) => result.status === "rejected");
  return {
    items: unique,
    status: {
      id: "bluesky",
      name: "Bluesky",
      ok: !allFailed,
      count: unique.length,
      error: allFailed ? [...new Set(errors)].slice(0, 2).join(" | ") : null,
      fallback: false
    }
  };
}
async function collectRound({ fetcher = fetch, now = /* @__PURE__ */ new Date(), feeds = FEEDS } = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1e3);
  const portalResults = await Promise.all(feeds.map((feed) => collectFeed(feed, cutoff, fetcher)));
  const portalItems = uniqueItems(portalResults.flatMap((result) => result.items), 180);
  const portalStatuses = portalResults.map((result) => result.status);
  if (!portalItems.length) {
    return {
      ok: false,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conte\xFAdo v\xE1lido nas \xFAltimas 24 horas.",
      sources: portalStatuses,
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
      items: [],
      topics: []
    };
  }
  const initialClusters = clusterItems(portalItems);
  const social = await collectBluesky(initialClusters, cutoff, fetcher);
  const allItems = uniqueItems([...portalItems, ...social.items]);
  const topics = buildTopics(allItems, collectedAt, 40);
  const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = allItems.filter((item) => item.kind === "social").length;
  return {
    ok: true,
    collectedAt: collectedAt.toISOString(),
    windowHours: 24,
    durationMs: Date.now() - startedAt,
    sources: [...portalStatuses, social.status],
    totals: {
      items: allItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems
    },
    items: allItems,
    topics
  };
}

// src/database.js
var initializedBindings = /* @__PURE__ */ new WeakSet();
var SCHEMA_STATEMENTS = [
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
  )`
];
async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' n\xE3o configurado.");
  if (initializedBindings.has(db)) return;
  for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
  initializedBindings.add(db);
}
async function acquireLock(db, name, ttlMs, nowMs = Date.now()) {
  await ensureSchema(db);
  const token = crypto.randomUUID();
  const expiresAt = nowMs + ttlMs;
  await db.prepare(`
      INSERT INTO locks (name, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE locks.expires_at < ?
    `).bind(name, token, expiresAt, nowMs).run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ?").bind(name).first();
  return row?.token === token ? { name, token, expiresAt } : null;
}
async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}
async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  const completedAt = payload.collectedAt || (/* @__PURE__ */ new Date()).toISOString();
  const totals = payload.totals ?? {};
  const status = payload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(payload);
  const retentionCutoff = new Date(Date.now() - 48 * 60 * 60 * 1e3).toISOString();
  const latestSummary = JSON.stringify({
    id,
    triggerType,
    status,
    completedAt,
    items: Number(totals.items) || 0,
    topics: Number(totals.topics) || 0,
    sources: Number(totals.sources) || 0
  });
  await db.batch([
    db.prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
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
      payloadJson
    ),
    db.prepare(`
        INSERT INTO app_state (key, value, updated_at) VALUES ('latest_run', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(latestSummary, completedAt),
    db.prepare("DELETE FROM runs WHERE completed_at < ?").bind(retentionCutoff),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(Date.now() - 5 * 60 * 1e3)
  ]);
  return { id, status, completedAt };
}
async function getLatestRound(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1").first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return { ...payload, runId: row.id, triggerType: row.trigger_type, storedAt: row.completed_at };
  } catch {
    throw new Error("A \xFAltima ronda armazenada est\xE1 corrompida.");
  }
}
async function getRunHistory(db, limit = 30) {
  await ensureSchema(db);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await db.prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs ORDER BY completed_at DESC LIMIT ?
    `).bind(safeLimit).all();
  return result?.results ?? [];
}
async function databaseHealth(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT 1 AS ok").first();
  return Number(row?.ok) === 1;
}
async function databaseSelfTest(db) {
  await ensureSchema(db);
  const id = `self-test-${crypto.randomUUID()}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let lock = null;
  try {
    await db.prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, 'self-test', 'self-test', ?, ?, 0, 0, 0, 0, NULL, NULL)
      `).bind(id, now, now).run();
    const written = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(id).first();
    lock = await acquireLock(db, `self-test-lock-${id}`, 1e4);
    return written?.id === id && Boolean(lock);
  } finally {
    await releaseLock(db, lock);
    await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  }
}

// src/ui.generated.js
var UI_ASSETS = Object.freeze({ "/": { "contentType": "text/html; charset=utf-8", "body": '<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="theme-color" content="#f3f6f4">\n  <meta name="description" content="Ronda editorial autom\xE1tica para acompanhamento de portais e fontes p\xFAblicas.">\n  <title>Ronda Editorial 24h</title>\n  <link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n  <main class="app">\n    <aside class="sidebar">\n      <button class="brand" id="goTop" type="button" aria-label="Voltar ao topo">RE</button>\n      <nav aria-label="Navega\xE7\xE3o principal">\n        <button class="nav active" id="navRound" type="button"><span class="nav-icon">R</span><span>Ronda</span></button>\n        <button class="nav" id="navSources" type="button"><span class="nav-icon">F</span><span>Fontes</span></button>\n        <button class="nav" id="navHistory" type="button"><span class="nav-icon">H</span><span>Hist\xF3rico</span></button>\n      </nav>\n      <button class="nav settings" id="openSettings" type="button"><span class="nav-icon">\xB7</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class="workspace" id="workspaceTop">\n      <header class="topbar">\n        <div><p class="eyebrow">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class="top-actions">\n          <button class="icon-button" id="settingsButton" type="button" aria-label="Abrir ajustes">\u2699</button>\n          <button class="run-round" id="runRound" type="button"><span>\u21BB</span>Executar ronda</button>\n          <div class="status"><span class="live" id="liveDot"></span><div><strong id="statusLabel">Conectando</strong><small id="statusSub">Verificando o servi\xE7o online</small></div></div>\n        </div>\n      </header>\n\n      <div class="notice"><span>Webapp</span><strong id="automationText">Automa\xE7\xE3o online em verifica\xE7\xE3o.</strong> O painel pode ser fechado; as rondas ficam armazenadas por 48 horas.</div>\n      <div class="source-health" id="sourceHealth"><span class="health-label">Fontes ainda n\xE3o consultadas</span></div>\n\n      <section class="summary" aria-label="Resumo da ronda">\n        <div><strong id="summaryContents">0</strong><span>novos conte\xFAdos</span><small>per\xEDodo selecionado</small></div>\n        <div><strong id="summaryTopics">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id="summaryChannels">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class="attention"><strong id="summaryUrgent">0</strong><span>pautar agora</span><small>alta recorr\xEAncia</small></div>\n      </section>\n\n      <section class="controls" aria-label="Filtros da ronda">\n        <label class="search"><span>\u2315</span><input id="searchInput" placeholder="Buscar assunto, ve\xEDculo ou canal" aria-label="Buscar assunto, ve\xEDculo ou canal"></label>\n        <div class="segmented" id="periodFilter" aria-label="Per\xEDodo">\n          <button data-value="5" type="button">5 min</button><button data-value="60" type="button">1h</button><button data-value="360" type="button">6h</button><button class="active" data-value="1440" type="button">24h</button>\n        </div>\n        <div class="segmented" id="sourceFilter" aria-label="Tipo de fonte">\n          <button class="active" data-value="Todos" type="button">Todos</button><button data-value="Portal" type="button">Portais</button><button data-value="Rede" type="button">Redes</button>\n        </div>\n      </section>\n\n      <div class="heading"><div><h2>Assuntos em destaque</h2><p>Ordenados por relev\xE2ncia editorial, recorr\xEAncia e atualidade</p></div><span class="last-update" id="lastUpdate">Sem coleta</span></div>\n      <section class="grid" id="topicsGrid" aria-live="polite"></section>\n    </section>\n  </main>\n\n  <div class="modal-backdrop" id="settingsModal" hidden>\n    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">\n      <div class="modal-head"><div><p class="eyebrow">Seguran\xE7a</p><h2 id="settingsTitle">Ajustes da opera\xE7\xE3o</h2></div><button class="close-modal" data-close="settingsModal" type="button" aria-label="Fechar">\xD7</button></div>\n      <p class="modal-copy">Se o Worker possuir a vari\xE1vel secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class="field"><span>Chave para executar ronda manual</span><input id="operationToken" type="password" autocomplete="off" placeholder="Opcional quando n\xE3o h\xE1 prote\xE7\xE3o"></label>\n      <p class="field-message" id="tokenMessage"></p>\n      <div class="modal-actions"><button class="secondary" data-close="settingsModal" type="button">Cancelar</button><button class="primary" id="saveSettings" type="button">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class="modal-backdrop" id="historyModal" hidden>\n    <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="historyTitle">\n      <div class="modal-head"><div><p class="eyebrow">\xDAltimas 48 horas</p><h2 id="historyTitle">Hist\xF3rico de rondas</h2></div><button class="close-modal" data-close="historyModal" type="button" aria-label="Fechar">\xD7</button></div>\n      <div class="history-list" id="historyList"><div class="loading-row">Carregando hist\xF3rico\u2026</div></div>\n    </section>\n  </div>\n\n  <script src="/app.js" defer><\/script>\n</body>\n</html>\n' }, "/index.html": { "contentType": "text/html; charset=utf-8", "body": '<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="theme-color" content="#f3f6f4">\n  <meta name="description" content="Ronda editorial autom\xE1tica para acompanhamento de portais e fontes p\xFAblicas.">\n  <title>Ronda Editorial 24h</title>\n  <link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n  <main class="app">\n    <aside class="sidebar">\n      <button class="brand" id="goTop" type="button" aria-label="Voltar ao topo">RE</button>\n      <nav aria-label="Navega\xE7\xE3o principal">\n        <button class="nav active" id="navRound" type="button"><span class="nav-icon">R</span><span>Ronda</span></button>\n        <button class="nav" id="navSources" type="button"><span class="nav-icon">F</span><span>Fontes</span></button>\n        <button class="nav" id="navHistory" type="button"><span class="nav-icon">H</span><span>Hist\xF3rico</span></button>\n      </nav>\n      <button class="nav settings" id="openSettings" type="button"><span class="nav-icon">\xB7</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class="workspace" id="workspaceTop">\n      <header class="topbar">\n        <div><p class="eyebrow">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class="top-actions">\n          <button class="icon-button" id="settingsButton" type="button" aria-label="Abrir ajustes">\u2699</button>\n          <button class="run-round" id="runRound" type="button"><span>\u21BB</span>Executar ronda</button>\n          <div class="status"><span class="live" id="liveDot"></span><div><strong id="statusLabel">Conectando</strong><small id="statusSub">Verificando o servi\xE7o online</small></div></div>\n        </div>\n      </header>\n\n      <div class="notice"><span>Webapp</span><strong id="automationText">Automa\xE7\xE3o online em verifica\xE7\xE3o.</strong> O painel pode ser fechado; as rondas ficam armazenadas por 48 horas.</div>\n      <div class="source-health" id="sourceHealth"><span class="health-label">Fontes ainda n\xE3o consultadas</span></div>\n\n      <section class="summary" aria-label="Resumo da ronda">\n        <div><strong id="summaryContents">0</strong><span>novos conte\xFAdos</span><small>per\xEDodo selecionado</small></div>\n        <div><strong id="summaryTopics">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id="summaryChannels">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class="attention"><strong id="summaryUrgent">0</strong><span>pautar agora</span><small>alta recorr\xEAncia</small></div>\n      </section>\n\n      <section class="controls" aria-label="Filtros da ronda">\n        <label class="search"><span>\u2315</span><input id="searchInput" placeholder="Buscar assunto, ve\xEDculo ou canal" aria-label="Buscar assunto, ve\xEDculo ou canal"></label>\n        <div class="segmented" id="periodFilter" aria-label="Per\xEDodo">\n          <button data-value="5" type="button">5 min</button><button data-value="60" type="button">1h</button><button data-value="360" type="button">6h</button><button class="active" data-value="1440" type="button">24h</button>\n        </div>\n        <div class="segmented" id="sourceFilter" aria-label="Tipo de fonte">\n          <button class="active" data-value="Todos" type="button">Todos</button><button data-value="Portal" type="button">Portais</button><button data-value="Rede" type="button">Redes</button>\n        </div>\n      </section>\n\n      <div class="heading"><div><h2>Assuntos em destaque</h2><p>Ordenados por relev\xE2ncia editorial, recorr\xEAncia e atualidade</p></div><span class="last-update" id="lastUpdate">Sem coleta</span></div>\n      <section class="grid" id="topicsGrid" aria-live="polite"></section>\n    </section>\n  </main>\n\n  <div class="modal-backdrop" id="settingsModal" hidden>\n    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">\n      <div class="modal-head"><div><p class="eyebrow">Seguran\xE7a</p><h2 id="settingsTitle">Ajustes da opera\xE7\xE3o</h2></div><button class="close-modal" data-close="settingsModal" type="button" aria-label="Fechar">\xD7</button></div>\n      <p class="modal-copy">Se o Worker possuir a vari\xE1vel secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class="field"><span>Chave para executar ronda manual</span><input id="operationToken" type="password" autocomplete="off" placeholder="Opcional quando n\xE3o h\xE1 prote\xE7\xE3o"></label>\n      <p class="field-message" id="tokenMessage"></p>\n      <div class="modal-actions"><button class="secondary" data-close="settingsModal" type="button">Cancelar</button><button class="primary" id="saveSettings" type="button">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class="modal-backdrop" id="historyModal" hidden>\n    <section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="historyTitle">\n      <div class="modal-head"><div><p class="eyebrow">\xDAltimas 48 horas</p><h2 id="historyTitle">Hist\xF3rico de rondas</h2></div><button class="close-modal" data-close="historyModal" type="button" aria-label="Fechar">\xD7</button></div>\n      <div class="history-list" id="historyList"><div class="loading-row">Carregando hist\xF3rico\u2026</div></div>\n    </section>\n  </div>\n\n  <script src="/app.js" defer><\/script>\n</body>\n</html>\n' }, "/styles.css": { "contentType": "text/css; charset=utf-8", "body": ':root{--ink:#17231e;--muted:#6e7b74;--line:#dfe7e2;--surface:#fff;--canvas:#f3f6f4;--green:#176b4b;--green-soft:#e9f4ee;--amber:#a85b15;--red:#b33b32}\n*{box-sizing:border-box}html{background:var(--canvas);scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px}button,input{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.app{min-height:100vh;display:grid;grid-template-columns:212px minmax(0,1fr)}\n.sidebar{position:sticky;top:0;height:100vh;padding:28px 18px 20px;background:#fbfdfc;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:42px}.brand{width:42px;height:42px;border:0;border-radius:12px;display:grid;place-items:center;background:var(--ink);color:#fff;font-size:13px;font-weight:800;letter-spacing:.06em;cursor:pointer}.sidebar nav{display:grid;gap:6px}.nav{width:100%;min-height:44px;padding:0 12px;border:0;border-radius:11px;display:grid;grid-template-columns:26px 1fr;align-items:center;gap:8px;background:transparent;color:#617068;cursor:pointer;text-align:left;font-weight:650}.nav:hover{background:#f0f4f2;color:var(--ink)}.nav.active{background:var(--green-soft);color:var(--green)}.nav-icon{font-size:11px;font-weight:850;width:22px;height:22px;border:1px solid currentColor;border-radius:7px;display:grid;place-items:center}.settings{margin-top:auto}\n.workspace{width:100%;max-width:1540px;margin:0 auto;padding:29px clamp(24px,3.1vw,54px) 70px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:32px}.eyebrow{margin:0 0 5px;color:var(--green);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.topbar h1{margin:0;font-size:clamp(27px,2.5vw,38px);line-height:1.08;letter-spacing:-.04em}.topbar h1 span{color:var(--muted);font-weight:500}.top-actions{display:flex;align-items:center;gap:10px}.icon-button{width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:#fff;color:#617068;cursor:pointer}.icon-button:hover{color:var(--green);border-color:#bad0c5}.run-round{height:46px;padding:0 17px;border:0;border-radius:12px;background:var(--green);color:#fff;display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:800;box-shadow:0 5px 14px rgba(23,107,75,.18)}.run-round:hover{background:#105b3e}.run-round:disabled{opacity:.65;cursor:wait}.run-round.loading span{animation:spin .8s linear infinite}.status{display:flex;align-items:center;gap:11px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:12px}.status div{display:flex;flex-direction:column;gap:2px}.status strong{font-size:12px}.status small{color:var(--muted);font-size:11px}.live{width:9px;height:9px;border-radius:50%;background:#9aa69f;box-shadow:0 0 0 4px #edf1ef}.live.ok{background:#1b9b61;box-shadow:0 0 0 4px #dff4e9}.live.error{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.live.warn{background:#d47c25;box-shadow:0 0 0 4px #fff1df}\n.notice{margin-top:23px;padding:10px 13px;background:#edf7f1;border:1px solid #d4e9dc;border-radius:10px;color:#52675c;font-size:12px}.notice>span{margin-right:8px;padding:3px 7px;background:#d9eee1;border-radius:5px;color:#245f45;font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:9px}.notice strong{font-weight:750}.source-health{margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:25px;scroll-margin-top:20px}.health-label{margin-right:3px;color:var(--muted);font-size:10px;font-weight:750}.health-chip{padding:5px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#66736c;font-size:9px;font-weight:750}.health-chip.ok{border-color:#cfe4d7;background:#f0f8f3;color:#256548}.health-chip.error{border-color:#f0d3cf;background:#fff5f3;color:#9a3c34}.health-message{padding:8px 10px;border-radius:8px;background:#fff5f3;color:#9a3c34;font-size:11px}.health-message.warn{background:#fff7ec;color:#925315}\n.summary{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:16px;display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden}.summary>div{min-height:90px;padding:19px 22px;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:12px;align-content:center;border-right:1px solid var(--line)}.summary>div:last-child{border-right:0}.summary strong{grid-row:1/3;align-self:center;font-size:30px;letter-spacing:-.05em}.summary span{align-self:end;font-weight:720;font-size:13px}.summary small{color:var(--muted);font-size:11px}.summary .attention{background:#fffbf8}.summary .attention strong{color:var(--red)}\n.controls{margin:18px 0 28px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search{height:42px;min-width:300px;flex:1 1 360px;display:flex;align-items:center;gap:9px;padding:0 13px;background:#fff;border:1px solid var(--line);border-radius:11px;color:var(--muted)}.search:focus-within{border-color:#93b7a6;box-shadow:0 0 0 3px #dfeee7}.search input{width:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:13px}.segmented{display:inline-flex;padding:3px;background:#e8eeeb;border-radius:10px}.segmented button{height:34px;padding:0 11px;border:0;border-radius:8px;background:transparent;color:#6c7771;cursor:pointer;font-size:11px;font-weight:750}.segmented button.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px #53685a25}.heading{margin-bottom:14px;display:flex;align-items:end;justify-content:space-between;gap:20px}.heading h2{margin:0;font-size:18px;letter-spacing:-.02em}.heading p{margin:4px 0 0;color:var(--muted);font-size:12px}.last-update{color:var(--muted);font-size:11px;font-weight:650}\n.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 5px 18px rgba(23,35,30,.035)}.accent{position:absolute;inset:0 auto 0 0;width:4px;background:#b9c5bf}.card.urgent .accent{background:var(--red)}.card.watch .accent{background:var(--amber)}.card-body{padding:20px 21px 18px 23px}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px}.priority{display:inline-flex;align-items:center;gap:7px;color:#6b7771;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.065em}.priority i{width:6px;height:6px;border-radius:50%;background:#8d9993}.urgent .priority{color:var(--red)}.urgent .priority i{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.watch .priority{color:var(--amber)}.watch .priority i{background:var(--amber)}.score{padding:5px 8px;background:#f0f4f2;border-radius:7px;color:#627069;font-size:10px;font-weight:800}.card h2{min-height:52px;margin:12px 0 11px;font-size:19px;line-height:1.35;letter-spacing:-.025em}.card-sources{margin:11px 0 2px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.card-sources>span:first-child{margin-right:2px;color:var(--muted);font-size:9px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.source-badge{padding:4px 7px;border-radius:999px;background:#edf3f0;color:#40574c;font-size:9px;font-weight:750}.published{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:10px;flex-wrap:wrap}.published strong{color:#4b5952;font-size:11px}.relative{padding-left:7px;border-left:1px solid var(--line);color:var(--green);font-weight:750}.metrics{margin-top:17px;display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:11px;overflow:hidden}.metric{min-height:61px;padding:10px;display:flex;flex-direction:column;justify-content:center;gap:4px;border-right:1px solid var(--line)}.metric:last-child{border:0}.metric span{color:var(--muted);font-size:9px;line-height:1.25}.metric strong{font-size:15px}.momentum{margin-top:12px;display:flex;align-items:center;gap:7px;color:var(--green);font-size:11px;font-weight:750}.trend{width:19px;height:19px;display:grid;place-items:center;background:var(--green-soft);border-radius:6px}.calculated{margin-left:auto;color:#919b96;font-size:9px;font-weight:600}.recommendation{margin-top:12px;padding:10px 11px;border-radius:9px;background:#f5f7f6;color:#55635c;font-size:10px;line-height:1.45}.recommendation strong{color:var(--ink)}\n.primary,.source{margin-top:13px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fbfcfb}.kicker{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:9px;flex-wrap:wrap}.kicker strong{color:#48564f}.kind{padding:3px 5px;border-radius:4px;background:#edf1ef;color:#5f6c65;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.kind.bluesky{background:#edf5ff;color:#26669c}.primary h3,.source h3{min-height:33px;margin:7px 0 9px;font-size:12px;line-height:1.38}.source-footer{display:flex;align-items:end;justify-content:space-between;gap:12px}.source-metrics{display:flex;gap:13px;color:var(--muted);font-size:9px;flex-wrap:wrap}.source-metrics strong{color:#4a5851}.open{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:8px 10px;border:1px solid #b9cec3;border-radius:8px;color:var(--green);text-decoration:none;font-size:9px;font-weight:800;white-space:nowrap}.open:hover{background:var(--green);border-color:var(--green);color:#fff}.toggle{width:100%;margin-top:14px;padding:12px 0 0;border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;background:#fff;color:var(--ink);cursor:pointer;font-size:11px;font-weight:780}.source-list{display:grid;gap:8px}.source{display:flex;align-items:center;gap:13px}.source>div{min-width:0;flex:1}.source h3{min-height:auto}.empty{grid-column:1/-1;min-height:220px;border:1px dashed #cbd6d0;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px;text-align:center;color:var(--muted)}.empty strong{color:var(--ink)}\n.modal-backdrop{position:fixed;z-index:100;inset:0;padding:24px;background:rgba(16,29,23,.42);display:grid;place-items:center}.modal-backdrop[hidden]{display:none}.modal{width:min(520px,100%);max-height:min(760px,calc(100vh - 48px));overflow:auto;padding:24px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 70px rgba(12,26,19,.22)}.modal-wide{width:min(820px,100%)}.modal-head{display:flex;align-items:start;justify-content:space-between;gap:20px}.modal h2{margin:0;font-size:21px}.close-modal{width:36px;height:36px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--muted);cursor:pointer;font-size:22px}.modal-copy{margin:17px 0;color:var(--muted);font-size:12px;line-height:1.55}.modal-copy code{padding:2px 5px;border-radius:5px;background:#eef2f0;color:var(--ink)}.field{display:grid;gap:7px}.field span{font-size:11px;font-weight:750}.field input{height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;outline:0}.field input:focus{border-color:#83ad99;box-shadow:0 0 0 3px #e1efe8}.field-message{min-height:18px;margin:7px 0 0;color:var(--red);font-size:10px}.modal-actions{margin-top:17px;display:flex;justify-content:flex-end;gap:8px}.primary,.secondary{height:40px;padding:0 14px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:800}.primary{border:0;background:var(--green);color:#fff}.secondary{border:1px solid var(--line);background:#fff;color:var(--ink)}.history-list{margin-top:18px;display:grid;border:1px solid var(--line);border-radius:12px;overflow:hidden}.history-row{min-height:55px;padding:10px 12px;display:grid;grid-template-columns:1.3fr .8fr repeat(3,.55fr);align-items:center;gap:10px;border-bottom:1px solid var(--line);font-size:11px}.history-row:last-child{border:0}.history-row strong{font-size:11px}.history-row span{color:var(--muted)}.history-status{justify-self:start;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800}.history-status.success{background:#e9f5ee;color:#226647}.history-status.failed{background:#fff0ee;color:#9b3e36}.loading-row{padding:30px;text-align:center;color:var(--muted);font-size:12px}\n@media(max-width:1180px){.app{grid-template-columns:76px minmax(0,1fr)}.sidebar{padding:24px 12px;align-items:center}.nav{grid-template-columns:1fr;width:44px;padding:0;place-items:center}.nav span:nth-child(2){display:none}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}}\n@media(max-width:900px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.summary>div:nth-child(2){border-right:0}.summary>div:nth-child(-n+2){border-bottom:1px solid var(--line)}.topbar{align-items:stretch;flex-direction:column}.top-actions{align-items:stretch}.run-round{flex:1;justify-content:center}.history-row{grid-template-columns:1.2fr .8fr repeat(2,.5fr)}.history-row span:last-child{display:none}}\n@media(max-width:700px){.app{display:block}.sidebar{z-index:10;width:100%;height:64px;padding:8px 12px;position:fixed;inset:auto 0 0;border:1px solid var(--line);flex-direction:row;justify-content:center;gap:10px}.brand,.settings{display:none}.sidebar nav{width:100%;display:flex;justify-content:space-around}.nav{width:52px;min-height:46px}.workspace{padding:22px 15px 94px}.icon-button{display:none}.status{padding:9px 12px}.summary>div{min-height:76px;padding:14px}.summary strong{font-size:24px}.search{min-width:100%}.heading p{display:none}.card-body{padding:18px 16px 16px 19px}.card h2{min-height:auto;font-size:18px}.source,.source-footer{align-items:stretch;flex-direction:column}.open{width:100%;justify-content:center}.calculated{display:none}.modal-backdrop{padding:12px}.modal{max-height:calc(100vh - 24px);padding:19px}.history-row{grid-template-columns:1.2fr .8fr .55fr}.history-row span:nth-last-child(-n+2){display:none}}\n@keyframes spin{to{transform:rotate(360deg)}}\n' }, "/app.js": { "contentType": "text/javascript; charset=utf-8", "body": 'const STORAGE_TOKEN = "ronda-editorial-operation-token-v1";\nconst state = {\n  data: null,\n  health: null,\n  query: "",\n  period: 1440,\n  source: "Todos",\n  expanded: new Set(),\n  running: false,\n  lastRunId: null,\n};\n\nconst numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });\nconst dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });\nconst runButton = document.getElementById("runRound");\nconst grid = document.getElementById("topicsGrid");\nconst liveDot = document.getElementById("liveDot");\nconst statusLabel = document.getElementById("statusLabel");\nconst statusSub = document.getElementById("statusSub");\n\nfunction escapeHtml(value) {\n  return String(value ?? "").replace(/[&<>\'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\'": "&#39;", \'"\': "&quot;" })[character]);\n}\n\nfunction safeUrl(value) {\n  try {\n    const url = new URL(String(value));\n    return /^https?:$/.test(url.protocol) ? url.toString() : "#";\n  } catch {\n    return "#";\n  }\n}\n\nfunction metricValue(value) {\n  return typeof value === "number" && Number.isFinite(value) && value > 0 ? numberFormat.format(value) : "N\xE3o dispon\xEDvel";\n}\n\nfunction formatDate(value) {\n  const date = new Date(value);\n  return Number.isFinite(date.getTime()) ? dateFormat.format(date).replace(",", "") : "Data n\xE3o informada";\n}\n\nfunction relativeTime(value) {\n  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));\n  if (minutes < 1) return "agora";\n  if (minutes < 60) return `h\xE1 ${minutes} min`;\n  const hours = Math.floor(minutes / 60);\n  return hours < 24 ? `h\xE1 ${hours}h` : `h\xE1 ${Math.floor(hours / 24)}d`;\n}\n\nfunction setStatus(type, label, sub) {\n  liveDot.className = `live ${type || ""}`;\n  statusLabel.textContent = label;\n  statusSub.textContent = sub;\n}\n\nasync function api(path, options = {}) {\n  const response = await fetch(path, { cache: "no-store", ...options });\n  const payload = response.status === 204 ? null : await response.json().catch(() => null);\n  if (!response.ok) {\n    const error = new Error(payload?.error || payload?.detail || `Falha HTTP ${response.status}`);\n    error.status = response.status;\n    error.payload = payload;\n    throw error;\n  }\n  return payload;\n}\n\nfunction itemMatchesSource(item) {\n  return state.source === "Todos" || (state.source === "Portal" ? item.kind === "portal" : item.kind === "social");\n}\n\nfunction itemWithinPeriod(item) {\n  const age = (Date.now() - Date.parse(item.publishedAt)) / 60_000;\n  return Number.isFinite(age) && age >= -5 && age <= state.period;\n}\n\nfunction sourceMarkup(item, primary = false) {\n  const platform = item.platform || (item.kind === "portal" ? "Portal" : "Rede");\n  const metrics = [`<span>Views: <strong>${metricValue(item.views)}</strong></span>`];\n  if (item.kind === "social") metrics.push(`<span>Coment\xE1rios: <strong>${metricValue(item.comments)}</strong></span>`);\n  return `<div class="${primary ? "primary" : "source"}"><div><div class="kicker"><span class="kind ${escapeHtml(platform.toLowerCase())}">${escapeHtml(platform)}</span><strong>${escapeHtml(item.sourceName)}</strong><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class="source-footer"><div class="source-metrics">${metrics.join("")}</div><a class="open" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">${item.kind === "portal" ? "Abrir para apura\xE7\xE3o" : "Ver post"} \u2197</a></div></div></div>`;\n}\n\nfunction renderSourceHealth(message = "", warning = false) {\n  const holder = document.getElementById("sourceHealth");\n  if (message) {\n    holder.innerHTML = `<span class="health-message ${warning ? "warn" : ""}">${escapeHtml(message)}</span>`;\n    return;\n  }\n  const sources = state.data?.sources || [];\n  if (!sources.length) {\n    holder.innerHTML = \'<span class="health-label">Fontes ainda n\xE3o consultadas</span>\';\n    return;\n  }\n  const okCount = sources.filter((source) => source.ok).length;\n  holder.innerHTML = `<span class="health-label">Fontes ${okCount}/${sources.length}</span>${sources.map((source) => `<span class="health-chip ${source.ok ? "ok" : "error"}" title="${escapeHtml(source.error || `${source.count} conte\xFAdos${source.fallback ? " por rota alternativa" : ""}`)}">${escapeHtml(source.name)} \xB7 ${source.ok ? `${source.count}${source.fallback ? " alt." : ""}` : "falhou"}</span>`).join("")}`;\n}\n\nfunction render() {\n  const topics = state.data?.topics || [];\n  const query = state.query.trim().toLocaleLowerCase("pt-BR");\n  const visible = topics\n    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))\n    .filter((topic) => topic.items.length && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(" ")}`.toLocaleLowerCase("pt-BR").includes(query)));\n\n  document.getElementById("summaryTopics").textContent = visible.length;\n  document.getElementById("summaryContents").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);\n  document.getElementById("summaryChannels").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;\n  document.getElementById("summaryUrgent").textContent = visible.filter((topic) => topic.tone === "urgent").length;\n\n  if (!state.data) {\n    grid.innerHTML = \'<div class="empty"><strong>Nenhuma ronda dispon\xEDvel</strong><span>A primeira coleta ser\xE1 executada pelo agendamento online ou pelo bot\xE3o Executar ronda.</span></div>\';\n    return;\n  }\n  if (!visible.length) {\n    grid.innerHTML = \'<div class="empty"><strong>Nenhum assunto neste filtro</strong><span>Retire um filtro ou aguarde uma nova ronda.</span></div>\';\n    return;\n  }\n\n  grid.innerHTML = visible.map((topic) => {\n    const items = [...topic.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));\n    const primary = items.find((item) => item.kind === "portal") || items[0];\n    const additional = items.filter((item) => item.id !== primary.id);\n    const sources = [...new Set(items.map((item) => item.sourceName))];\n    const views = items.reduce((sum, item) => sum + (Number(item.views) || 0), 0);\n    const comments = items.reduce((sum, item) => sum + (Number(item.comments) || 0), 0);\n    const latest = items[0].publishedAt;\n    const open = state.expanded.has(topic.id);\n    return `<article class="card ${escapeHtml(topic.tone)}"><div class="accent"></div><div class="card-body"><div class="topline"><span class="priority"><i></i>${escapeHtml(topic.priority)}</span><span class="score">\xCDndice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class="card-sources"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<span class="source-badge">${escapeHtml(source)}</span>`).join("")}${sources.length > 6 ? `<span class="source-badge">+${sources.length - 6}</span>` : ""}</div><div class="published"><span>\xDAltima postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class="relative">${escapeHtml(relativeTime(latest))}</span></div><div class="metrics"><div class="metric"><span>Visualiza\xE7\xF5es observadas</span><strong>${metricValue(views)}</strong></div><div class="metric"><span>Coment\xE1rios</span><strong>${metricValue(comments)}</strong></div><div class="metric"><span>Fontes diferentes</span><strong>${sources.length}</strong></div><div class="metric"><span>Conte\xFAdos</span><strong>${items.length}</strong></div></div><div class="momentum"><span class="trend">\u2197</span><span>${escapeHtml(topic.momentum)}</span><span class="calculated">calculado nesta ronda</span></div><div class="recommendation"><strong>Recomenda\xE7\xE3o editorial:</strong> ${escapeHtml(topic.recommendation || "Confirmar as informa\xE7\xF5es nas fontes originais antes de publicar.")}</div>${sourceMarkup(primary, true)}${additional.length ? `<button class="toggle" data-toggle="${escapeHtml(topic.id)}" aria-expanded="${open}" type="button"><span>${open ? "Ocultar outras fontes" : `Ver mais ${additional.length} ${additional.length === 1 ? "fonte" : "fontes"}`}</span><span>${open ? "\u2303" : "\u2304"}</span></button>` : ""}${open ? `<div class="source-list">${additional.map((item) => sourceMarkup(item)).join("")}</div>` : ""}</div></article>`;\n  }).join("");\n\n  grid.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {\n    const id = button.dataset.toggle;\n    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);\n    render();\n  }));\n}\n\nfunction applyRound(payload) {\n  if (!payload?.ok || !Array.isArray(payload.topics)) return;\n  state.data = payload;\n  state.lastRunId = payload.runId || state.lastRunId;\n  state.expanded.clear();\n  document.getElementById("lastUpdate").textContent = `\xDAltima coleta: ${formatDate(payload.collectedAt)}`;\n  renderSourceHealth();\n  render();\n}\n\nasync function loadLatest({ quiet = false } = {}) {\n  try {\n    const response = await api(`/api/latest?t=${Date.now()}`);\n    const payload = response?.data;\n    if (payload?.ok && (!state.lastRunId || payload.runId !== state.lastRunId)) applyRound(payload);\n    return payload;\n  } catch (error) {\n    if (!quiet) renderSourceHealth(error.message);\n    return null;\n  }\n}\n\nfunction openModal(id) {\n  const modal = document.getElementById(id);\n  modal.hidden = false;\n  const input = modal.querySelector("input");\n  if (input) setTimeout(() => input.focus(), 0);\n}\n\nfunction closeModal(id) {\n  document.getElementById(id).hidden = true;\n}\n\nfunction operationToken() {\n  try { return localStorage.getItem(STORAGE_TOKEN) || ""; } catch { return ""; }\n}\n\nasync function executeRound(automatic = false) {\n  if (state.running) return;\n  const token = operationToken();\n  if (state.health?.manualAuthRequired && !token) {\n    document.getElementById("tokenMessage").textContent = "Informe a chave configurada no Worker para executar manualmente.";\n    openModal("settingsModal");\n    return;\n  }\n  state.running = true;\n  runButton.disabled = true;\n  runButton.classList.add("loading");\n  runButton.innerHTML = "<span>\u21BB</span>Coletando fontes\u2026";\n  setStatus("", "Ronda em andamento", "Consultando portais e fontes sociais");\n  try {\n    const payload = await api("/api/round", {\n      method: "POST",\n      headers: { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) },\n      body: JSON.stringify({ source: automatic ? "initial" : "button" }),\n    });\n    applyRound(payload.data);\n    setStatus("ok", "Ronda conclu\xEDda", `Coleta finalizada \xE0s ${new Date(payload.data.collectedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);\n  } catch (error) {\n    if (error.status === 401) {\n      document.getElementById("tokenMessage").textContent = "Chave incorreta. Confira a vari\xE1vel MANUAL_ROUND_TOKEN.";\n      openModal("settingsModal");\n    }\n    const locked = error.status === 409 || error.status === 429;\n    setStatus(locked ? "warn" : "error", locked ? "Ronda j\xE1 em andamento" : "Falha ao executar a ronda", error.message);\n    renderSourceHealth(error.message, locked);\n  } finally {\n    state.running = false;\n    runButton.disabled = false;\n    runButton.classList.remove("loading");\n    runButton.innerHTML = "<span>\u21BB</span>Executar ronda";\n  }\n}\n\nasync function checkHealth() {\n  try {\n    const health = await api(`/api/health?t=${Date.now()}`);\n    state.health = health;\n    document.getElementById("automationText").textContent = health.schedulerHealthy\n      ? "Automa\xE7\xE3o online ativa e atualizada."\n      : health.lastSuccessAt\n        ? "Automa\xE7\xE3o online configurada; a \xFAltima ronda est\xE1 atrasada."\n        : "Servi\xE7o online pronto; aguardando a primeira ronda.";\n    setStatus(health.schedulerHealthy ? "ok" : "warn", health.schedulerHealthy ? "Servi\xE7o online" : "Aguardando automa\xE7\xE3o", health.lastSuccessAt ? `\xDAltima ronda ${relativeTime(health.lastSuccessAt)}` : "Execute a primeira ronda");\n    return true;\n  } catch (error) {\n    state.health = null;\n    setStatus("error", "Webapp n\xE3o configurado", error.message);\n    renderSourceHealth(error.message);\n    document.getElementById("automationText").textContent = "Configura\xE7\xE3o incompleta no Cloudflare.";\n    return false;\n  }\n}\n\nasync function showHistory() {\n  openModal("historyModal");\n  const holder = document.getElementById("historyList");\n  holder.innerHTML = \'<div class="loading-row">Carregando hist\xF3rico\u2026</div>\';\n  try {\n    const payload = await api("/api/history?limit=50");\n    const runs = payload?.runs || [];\n    holder.innerHTML = runs.length ? runs.map((run) => `<div class="history-row"><div><strong>${escapeHtml(formatDate(run.completed_at))}</strong><br><span>${run.trigger_type === "scheduled" ? "Autom\xE1tica" : "Manual"}</span></div><span class="history-status ${run.status}">${run.status === "success" ? "Conclu\xEDda" : "Falhou"}</span><span>${Number(run.items_count) || 0} conte\xFAdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span>${Number(run.sources_count) || 0} fontes</span></div>`).join("") : \'<div class="loading-row">Nenhuma ronda armazenada.</div>\';\n  } catch (error) {\n    holder.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;\n  }\n}\n\nasync function startApplication() {\n  render();\n  document.getElementById("operationToken").value = operationToken();\n  const healthy = await checkHealth();\n  if (!healthy) return;\n  const latest = await loadLatest();\n  if (!latest && (!state.health.manualAuthRequired || operationToken())) executeRound(true);\n}\n\nrunButton.addEventListener("click", () => executeRound(false));\ndocument.getElementById("searchInput").addEventListener("input", (event) => { state.query = event.target.value; render(); });\ndocument.getElementById("periodFilter").addEventListener("click", (event) => {\n  if (!event.target.matches("button")) return;\n  state.period = Number(event.target.dataset.value);\n  event.currentTarget.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === event.target));\n  render();\n});\ndocument.getElementById("sourceFilter").addEventListener("click", (event) => {\n  if (!event.target.matches("button")) return;\n  state.source = event.target.dataset.value;\n  event.currentTarget.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === event.target));\n  state.expanded.clear();\n  render();\n});\ndocument.getElementById("settingsButton").addEventListener("click", () => openModal("settingsModal"));\ndocument.getElementById("openSettings").addEventListener("click", () => openModal("settingsModal"));\ndocument.getElementById("navHistory").addEventListener("click", showHistory);\ndocument.getElementById("navSources").addEventListener("click", () => document.getElementById("sourceHealth").scrollIntoView({ behavior: "smooth", block: "center" }));\ndocument.getElementById("navRound").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));\ndocument.getElementById("goTop").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));\ndocument.getElementById("saveSettings").addEventListener("click", () => {\n  const token = document.getElementById("operationToken").value.trim();\n  try { token ? localStorage.setItem(STORAGE_TOKEN, token) : localStorage.removeItem(STORAGE_TOKEN); } catch {}\n  document.getElementById("tokenMessage").textContent = "";\n  closeModal("settingsModal");\n});\ndocument.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));\ndocument.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));\ndocument.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id)); });\n\nsetInterval(async () => {\n  if (state.running || !state.health) return;\n  await checkHealth();\n  await loadLatest({ quiet: true });\n}, 30_000);\n\nstartApplication();\n' } });

// src/index.js
var VERSION = "1.0.0";
var JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
var SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};
var HttpError = class extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
};
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extraHeaders } });
}
function assetResponse(asset) {
  return new Response(asset.body, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": asset.contentType,
      "Cache-Control": asset.contentType.startsWith("text/html") ? "no-cache" : "public, max-age=300, must-revalidate"
    }
  });
}
function secureEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ""));
  const b = new TextEncoder().encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "Banco D1 n\xE3o configurado.", "Crie um banco D1 e adicione ao Worker um binding chamado DB.");
  return env.DB;
}
async function performRound(env, triggerType) {
  const db = requireDatabase(env);
  await ensureSchema(db);
  const lock = await acquireLock(db, "editorial-round", 3 * 60 * 1e3);
  if (!lock) throw new HttpError(409, "J\xE1 existe uma ronda em andamento.");
  const runId = crypto.randomUUID();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    let payload;
    try {
      payload = await collectRound();
    } catch (error) {
      payload = {
        ok: false,
        collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
        windowHours: 24,
        durationMs: Date.now() - Date.parse(startedAt),
        error: "A coleta foi interrompida por um erro interno.",
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: []
      };
    }
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    const storedPayload = { ...payload, runId, triggerType };
    if (!payload.ok) throw new HttpError(503, payload.error, payload.detail || null);
    return storedPayload;
  } finally {
    await releaseLock(db, lock);
  }
}
async function selfTest() {
  const now = /* @__PURE__ */ new Date();
  const published = now.toUTCString();
  const fixture = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://example.test/a</link><pubDate>${published}</pubDate><description>Teste A</description></item>
    <item><title>Plano de mobilidade urbana \xE9 anunciado pela prefeitura</title><link>https://example.test/b</link><pubDate>${published}</pubDate><description>Teste B</description></item>
  </channel></rss>`;
  const items = parseFeed(fixture, { id: "test", name: "Teste" }, new Date(now.getTime() - 864e5));
  const topics = buildTopics(items, now);
  return {
    ok: items.length === 2 && topics.length === 1 && topics[0].itemCount === 2,
    parserItems: items.length,
    groupedTopics: topics.length,
    cardItems: topics[0]?.itemCount ?? 0
  };
}
async function handleApi(request, env, url) {
  if (url.pathname === "/api/self-test" && request.method === "GET") {
    const logic = await selfTest();
    const db = requireDatabase(env);
    const databaseOk = await databaseSelfTest(db);
    const result = {
      ...logic,
      ok: logic.ok && databaseOk,
      database: { configured: true, readWriteDelete: databaseOk }
    };
    return json(result, result.ok ? 200 : 500);
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    const db = requireDatabase(env);
    const dbOk = await databaseHealth(db);
    const latest = await getLatestRound(db);
    const lastSuccessAt = latest?.collectedAt ?? null;
    const ageMs = lastSuccessAt ? Date.now() - Date.parse(lastSuccessAt) : Number.POSITIVE_INFINITY;
    return json({
      ok: dbOk,
      ready: dbOk,
      service: "ronda-editorial-webapp",
      version: VERSION,
      database: dbOk ? "connected" : "error",
      scheduleMinutes: 5,
      schedulerHealthy: ageMs <= 12 * 60 * 1e3,
      lastSuccessAt,
      lastRunId: latest?.runId ?? null,
      manualAuthRequired: Boolean(env.MANUAL_ROUND_TOKEN)
    });
  }
  if (url.pathname === "/api/latest" && request.method === "GET") {
    const latest = await getLatestRound(requireDatabase(env));
    return json({ ok: true, data: latest });
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    const runs = await getRunHistory(requireDatabase(env), url.searchParams.get("limit"));
    return json({ ok: true, runs });
  }
  if (url.pathname === "/api/round" && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de opera\xE7\xE3o inv\xE1lida.");
    }
    const db = requireDatabase(env);
    const throttle = await acquireLock(db, "manual-throttle", 60 * 1e3);
    if (!throttle) throw new HttpError(429, "Aguarde um minuto antes de executar outra ronda manual.");
    const data = await performRound(env, "manual");
    return json({ ok: true, data });
  }
  throw new HttpError(404, "Rota n\xE3o encontrada.");
}
async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "M\xE9todo n\xE3o permitido.");
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /api/\n", { headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  const asset = UI_ASSETS[url.pathname];
  if (asset) return request.method === "HEAD" ? new Response(null, { headers: { ...SECURITY_HEADERS, "Content-Type": asset.contentType } }) : assetResponse(asset);
  return json({ ok: false, error: "P\xE1gina n\xE3o encontrada." }, 404);
}
var index_default = {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Erro interno do servi\xE7o.";
      const detail = error instanceof HttpError ? error.detail : error instanceof Error ? error.message.slice(0, 300) : null;
      return json({ ok: false, error: message, ...detail ? { detail } : {} }, status);
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      performRound(env, "scheduled").catch((error) => {
        console.error("Ronda agendada falhou", error);
      })
    );
  }
};
export {
  index_default as default,
  handleRequest,
  performRound,
  selfTest
};
