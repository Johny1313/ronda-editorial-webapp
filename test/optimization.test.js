import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectFeed, collectRound, runPool } from "../src/collector.js";
import { withEditorias } from "../src/index.js";

const NOW = new Date("2026-07-27T12:00:00Z");
const CUTOFF = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

function item(url = "https://example.test/noticia") {
  return {
    id: "cached-1",
    title: "Plano de mobilidade urbana é aprovado",
    description: "Medida foi aprovada e terá implantação gradual.",
    sourceName: "Exemplo",
    collectorName: "Exemplo",
    region: "Brasil",
    platform: "Portal",
    kind: "portal",
    publishedAt: "2026-07-27T10:00:00Z",
    url,
  };
}

test("pool nunca ultrapassa a concorrência configurada", async () => {
  let active = 0;
  let maximum = 0;
  const values = await runPool(Array.from({ length: 18 }, (_, index) => index), 5, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(maximum, 5);
  assert.equal(values.length, 18);
  assert.equal(values[17], 34);
});

test("fonte fora do horário usa snapshot persistente sem consultar o portal", async () => {
  const feed = {
    id: "example",
    name: "Exemplo",
    region: "Brasil",
    directUrl: "https://example.test/rss",
    urls: ["https://example.test/rss"],
    limit: 15,
    refreshMinutes: 30,
  };
  const sourceStates = new Map([["example", {
    sourceId: "example",
    name: "Exemplo",
    region: "Brasil",
    status: "direct",
    route: "direct",
    items: [item()],
    nextCheckAt: "2026-07-27T12:20:00Z",
    lastSuccessAt: "2026-07-27T11:50:00Z",
    validators: {},
  }]]);
  const requested = [];
  const result = await collectRound({
    now: NOW,
    feeds: [feed],
    sourceStates,
    fetcher: async (url) => {
      requested.push(String(url));
      if (String(url).includes("bsky")) return Response.json({ posts: [] });
      throw new Error("O portal não deveria ser consultado.");
    },
  });
  assert.equal(requested.some((url) => url === feed.directUrl), false);
  assert.equal(result.sources[0].deferred, true);
  assert.equal(result.sources[0].route, "cache");
  assert.equal(result.operational.externalPortalRequests, 0);
});

test("ETag evita baixar e interpretar novamente um feed sem alteração", async () => {
  const feed = {
    id: "example",
    name: "Exemplo",
    region: "Brasil",
    directUrl: "https://example.test/rss",
    urls: ["https://example.test/rss"],
    limit: 15,
    refreshMinutes: 5,
  };
  const state = {
    lastUrl: feed.directUrl,
    items: [item()],
    validators: { [feed.directUrl]: { etag: '"abc"', lastModified: "Sun, 27 Jul 2026 10:00:00 GMT" } },
  };
  const result = await collectFeed(feed, CUTOFF, async (_url, options) => {
    assert.equal(options.headers["If-None-Match"], '"abc"');
    return new Response(null, { status: 304 });
  }, { remaining: 5, seenUrls: new Set() }, state);
  assert.equal(result.status.ok, true);
  assert.equal(result.status.route, "not-modified");
  assert.equal(result.items.length, 1);
});

test("diagnóstico diferencia bloqueio de falha genérica", async () => {
  const feed = { id: "blocked", name: "Bloqueado", region: "Brasil", urls: ["https://example.test/rss"], limit: 15 };
  const result = await collectFeed(feed, CUTOFF, async () => new Response("negado", { status: 403 }));
  assert.equal(result.status.ok, false);
  assert.equal(result.status.errorCode, "blocked");
  assert.equal(result.status.httpStatus, 403);
});

test("publicação usa assets estáticos, fila de rondas e polling condicional", async () => {
  const [wrangler, app, index] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
  ]);
  assert.match(wrangler, /"assets"\s*:/);
  assert.match(wrangler, /ROUND_JOBS_QUEUE/);
  assert.match(wrangler, /YOUTUBE_JOBS_QUEUE/);
  assert.match(wrangler, /dead_letter_queue/);
  assert.match(app, /\/api\/status/);
  assert.match(app, /If-None-Match/);
  assert.doesNotMatch(app, /setInterval\(/);
  assert.doesNotMatch(index, /ui\.generated/);
  assert.match(index, /freshActiveRun/);
  assert.match(index, /activeRunStatus/);
  assert.match(index, /expireStaleRuns/);
  assert.match(index, /status: "queued"/);
  assert.match(index, /scheduled_round_skipped/);
  assert.match(index, /processYouTubeQueueMessage/);
  assert.match(index, /\/api\/youtube\/status/);
  assert.match(index, /reused: true/);
});

test("estado da ronda usa fila, início real, heartbeat e expiração", async () => {
  const [database, index, migration, app] = await Promise.all([
    readFile(new URL("../src/database.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0003_round_state_machine.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(database, /export async function queueRun/);
  assert.match(database, /export async function markRunStarted/);
  assert.match(database, /export async function touchRun/);
  assert.match(database, /export async function expireStaleRuns/);
  assert.match(database, /status = 'expired'/);
  assert.match(index, /await markRunStarted\(db/);
  assert.match(index, /activeRunStatus/);
  assert.match(index, /fixed-39-no-curiosity-v1/);
  assert.match(migration, /queued_at TEXT NOT NULL/);
  assert.match(migration, /heartbeat_at TEXT/);
  assert.match(app, /Ronda na fila/);
  assert.match(app, /\["failed", "expired"\]/);
});


test("snapshot antigo remove canais fora do catálogo atual", () => {
  const oldPayload = {
    ok: true,
    schemaVersion: 4,
    collectedAt: "2026-07-27T12:00:00Z",
    translation: { targetLanguage: "pt-BR", portugueseOnly: true },
    sources: [
      { id: "g1", name: "G1", region: "Brasil", count: 1, ok: true },
      { id: "fatos-desconhecidos", name: "Fatos Desconhecidos", region: "Brasil", count: 1, ok: true },
    ],
    items: [
      { ...item("https://g1.globo.com/noticia"), id: "g1-1", sourceName: "G1", collectorName: "G1" },
      { ...item("https://fatos.test/noticia"), id: "fd-1", sourceName: "Fatos Desconhecidos", collectorName: "Fatos Desconhecidos" },
    ],
    topics: [],
    totals: { items: 2, topics: 0, sources: 2, socialItems: 0 },
  };
  const filtered = withEditorias(oldPayload);
  assert.equal(filtered.sources.length, 1);
  assert.equal(filtered.sources[0].name, "G1");
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].collectorName, "G1");
  assert.equal(filtered.catalog.portals, 39);
  assert.equal(filtered.schemaVersion, 5);
});
