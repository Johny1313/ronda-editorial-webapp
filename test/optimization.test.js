import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectFeed, collectRound, runPool } from "../src/collector.js";

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
  assert.match(wrangler, /dead_letter_queue/);
  assert.match(app, /\/api\/status/);
  assert.match(app, /If-None-Match/);
  assert.doesNotMatch(app, /setInterval\(/);
  assert.doesNotMatch(index, /ui\.generated/);
  assert.match(index, /freshRunningRun/);
  assert.match(index, /scheduled_round_skipped/);
  assert.match(index, /reused: true/);
});
