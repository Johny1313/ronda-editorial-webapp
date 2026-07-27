import assert from "node:assert/strict";
import test from "node:test";
import { collectFeed, collectRound, customSourceFeed, FEED_COUNTS, FEEDS } from "../src/collector.js";

const now = new Date("2026-07-22T12:00:00Z");
const fallbackXml = `<rss><channel>
  <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://portal.test/a</link><pubDate>Wed, 22 Jul 2026 11:50:00 GMT</pubDate></item>
  <item><title>Plano de mobilidade urbana é anunciado pela prefeitura</title><link>https://portal.test/b</link><pubDate>Wed, 22 Jul 2026 11:45:00 GMT</pubDate></item>
</channel></rss>`;

test("catálogo contém 37 portais do Brasil e 13 do Mundo", () => {
  assert.equal(FEEDS.length, 50);
  assert.deepEqual(FEED_COUNTS, { Brasil: 37, Mundo: 13, total: 50 });
  assert.equal(new Set(FEEDS.map((feed) => feed.id)).size, 50);
  assert.equal(new Set(FEEDS.map((feed) => feed.name)).size, 50);
  assert.ok(FEEDS.every((feed) => feed.canonicalSource && feed.urls.length >= 1));
  assert.ok(FEEDS.some((feed) => feed.name === "Metrópoles"));
  assert.ok(FEEDS.some((feed) => feed.name === "Canaltech"));
  assert.ok(FEEDS.some((feed) => feed.name === "TecMundo"));
  assert.ok(FEEDS.some((feed) => feed.name === "ABC News Australia"));
  assert.ok(FEEDS.some((feed) => feed.name === "UOL Splash"));
  assert.ok(FEEDS.some((feed) => feed.name === "LeoDias"));
  assert.ok(FEEDS.some((feed) => feed.name === "Superinteressante"));
  assert.ok(FEEDS.some((feed) => feed.name === "Awebic"));
});

test("reaproveita uma consulta agregada para vários portais sem misturar as fontes", async () => {
  const sharedUrl = "https://news.google.com/rss/search?q=grupo";
  const feeds = [
    { id: "leo", name: "LeoDias", region: "Brasil", canonicalSource: true, sourceAliases: ["LeoDias"], scanLimit: 50, urls: [sharedUrl] },
    { id: "quem", name: "Quem", region: "Brasil", canonicalSource: true, sourceAliases: ["Quem"], scanLimit: 50, urls: [sharedUrl] },
  ];
  const xml = `<rss><channel>
    <item><title>Artista confirma novo relacionamento</title><link>https://leo.test/a</link><pubDate>Wed, 22 Jul 2026 11:58:00 GMT</pubDate><source>LeoDias</source></item>
    <item><title>Atriz fala sobre os bastidores da carreira</title><link>https://quem.test/b</link><pubDate>Wed, 22 Jul 2026 11:57:00 GMT</pubDate><source>Quem</source></item>
  </channel></rss>`;
  let requests = 0;
  const fetcher = async (url) => {
    if (String(url) === sharedUrl) { requests += 1; return new Response(xml, { headers: { "Content-Type": "application/rss+xml" } }); }
    if (String(url).startsWith("https://public.api.bsky.app/")) return Response.json({ posts: [] });
    return new Response("não encontrado", { status: 404 });
  };
  const result = await collectRound({ fetcher, now, feeds });
  assert.equal(result.ok, true);
  assert.equal(requests, 1);
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources.find((source) => source.name === "LeoDias")?.count, 1);
  assert.equal(result.sources.find((source) => source.name === "Quem")?.count, 1);
  assert.deepEqual(new Set(result.items.filter((item) => item.kind === "portal").map((item) => item.sourceName)), new Set(["LeoDias", "Quem"]));
});

test("usa fallback do portal e complementa com Bluesky", async () => {
  const feed = { id: "portal", name: "Portal", urls: ["https://direct.test/rss", "https://fallback.test/rss"] };
  const fetcher = async (url) => {
    if (url === feed.urls[0]) return new Response("bloqueado", { status: 403 });
    if (url === feed.urls[1]) return new Response(fallbackXml, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
    if (String(url).startsWith("https://public.api.bsky.app/")) {
      return Response.json({ posts: [{
        uri: "at://did:plc:test/app.bsky.feed.post/abc",
        indexedAt: "2026-07-22T11:55:00Z",
        record: { text: "Plano de mobilidade urbana ganha repercussão", createdAt: "2026-07-22T11:55:00Z" },
        author: { handle: "jornalista.test", displayName: "Jornalista" },
        replyCount: 8, likeCount: 20, repostCount: 3, quoteCount: 1,
      }] });
    }
    return new Response("não encontrado", { status: 404 });
  };

  const result = await collectRound({ fetcher, now, feeds: [feed] });
  assert.equal(result.ok, true);
  assert.equal(result.sources[0].fallback, true);
  assert.equal(result.sources[0].count, 2);
  assert.equal(result.sources.at(-1).name, "Bluesky");
  assert.ok(result.totals.socialItems >= 1);
  assert.ok(result.topics.length >= 1);
  assert.ok(result.items.every((item) => /^https?:\/\//i.test(item.url)));
  assert.ok(result.topics.every((topic) => topic.carousel.verificationLinks.length === new Set(topic.items.map((item) => item.url)).size));
});

test("falha de todas as fontes retorna diagnóstico estruturado", async () => {
  const feed = { id: "falha", name: "Falha", urls: ["https://fail.test/rss"] };
  const result = await collectRound({ fetcher: async () => new Response("erro", { status: 500 }), now, feeds: [feed] });
  assert.equal(result.ok, false);
  assert.equal(result.sources[0].ok, false);
  assert.match(result.error, /Nenhuma fonte/);
});

test("decodifica RSS Windows-1252 sem corromper acentos", async () => {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel>
    <item><title>Assédio e polêmica no Japão</title><link>https://portal.test/acentos</link><pubDate>Wed, 22 Jul 2026 11:50:00 GMT</pubDate></item>
  </channel></rss>`;
  const bytes = Uint8Array.from([...xml].map((character) => {
    const replacements = { "é": 0xe9, "ê": 0xea, "ã": 0xe3 };
    return replacements[character] ?? character.charCodeAt(0);
  }));
  const feed = { id: "acentos", name: "Portal Acentos", urls: ["https://portal.test/rss"] };
  const result = await collectFeed(feed, new Date("2026-07-21T12:00:00Z"), async () => new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "application/rss+xml; charset=ISO-8859-1" },
  }));
  assert.equal(result.status.ok, true);
  assert.equal(result.items[0].title, "Assédio e polêmica no Japão");
});

test("transforma site cadastrado em fonte da ronda com fallback por domínio", () => {
  const source = customSourceFeed({
    id: "site-1",
    name: "Portal Local",
    url: "https://portal-local.test/",
    region: "Brasil",
  });
  assert.equal(source.id, "custom-site-1");
  assert.equal(source.name, "Portal Local");
  assert.equal(source.custom, true);
  assert.equal(source.urls.length, 1);
  assert.match(source.urls[0], /news\.google\.com\/rss\/search/);
  assert.match(decodeURIComponent(source.urls[0]), /site:portal-local\.test/);
});

test("mantém notícias de termos fora dos itens e assuntos da ronda", async () => {
  const feed = { id: "principal", name: "Portal Principal", region: "Brasil", urls: ["https://principal.test/rss"] };
  const termXml = `<rss><channel>
    <item><title>Vini Jr marca e decide partida internacional</title><link>https://esporte.test/vini-gol</link><pubDate>Wed, 22 Jul 2026 11:58:00 GMT</pubDate><description>Atacante foi destaque.</description></item>
  </channel></rss>`;
  const fetcher = async (url) => {
    const value = String(url);
    if (value === feed.urls[0]) return new Response(fallbackXml, { headers: { "Content-Type": "application/rss+xml" } });
    if (value.includes("news.google.com/rss/search")) return new Response(termXml, { headers: { "Content-Type": "application/rss+xml" } });
    if (value.startsWith("https://public.api.bsky.app/")) return Response.json({ posts: [] });
    return new Response("não encontrado", { status: 404 });
  };
  const result = await collectRound({
    fetcher,
    now,
    feeds: [feed],
    monitoringTerms: [{ id: "term-vini", term: "Vini Jr" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.dedicatedMonitoring.enabled, true);
  assert.equal(result.dedicatedMonitoring.items.length, 1);
  assert.equal(result.dedicatedMonitoring.items[0].monitoringTerm, "Vini Jr");
  assert.equal(result.totals.dedicatedItems, 1);
  assert.ok(result.items.every((item) => item.kind !== "monitoring"));
  assert.ok(result.topics.every((topic) => topic.items.every((item) => item.kind !== "monitoring")));
});

test("recupera a última coleta válida quando a fonte falha temporariamente", async () => {
  const feed = { id: "cache", name: "Portal Cache", region: "Brasil", canonicalSource: true, directUrl: "https://cache.test/rss", urls: ["https://cache.test/rss"], limit: 10 };
  const previousRound = {
    items: [{
      id: "rss-cache-anterior",
      title: "Notícia ainda válida da coleta anterior",
      description: "Resumo anterior",
      content: "Resumo anterior",
      sourceName: "Portal Cache",
      collectorName: "Portal Cache",
      region: "Brasil",
      platform: "Portal",
      kind: "portal",
      publishedAt: "2026-07-22T11:40:00Z",
      url: "https://cache.test/noticia",
    }],
  };
  const result = await collectRound({
    fetcher: async (url) => String(url).startsWith("https://public.api.bsky.app/") ? Response.json({ posts: [] }) : new Response("erro", { status: 503 }),
    now,
    feeds: [feed],
    previousRound,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sources[0].ok, true);
  assert.equal(result.sources[0].cached, true);
  assert.equal(result.sources[0].route, "cache");
  assert.equal(result.sources[0].count, 1);
  assert.equal(result.items[0].collectionRoute, "cache");
});

test("feed oficial não exige tag source para ser reconhecido", async () => {
  const feed = {
    id: "direto",
    name: "Portal Direto",
    region: "Brasil",
    canonicalSource: true,
    directUrl: "https://direto.test/rss",
    sourceAliases: ["Portal Direto"],
    sourceDomains: ["direto.test"],
    urls: ["https://direto.test/rss"],
  };
  const xml = `<rss><channel><item><title>Notícia do feed oficial</title><link>https://direto.test/noticia</link><pubDate>Wed, 22 Jul 2026 11:55:00 GMT</pubDate></item></channel></rss>`;
  const result = await collectFeed(feed, new Date("2026-07-21T12:00:00Z"), async () => new Response(xml, { headers: { "Content-Type": "application/rss+xml" } }));
  assert.equal(result.status.ok, true);
  assert.equal(result.status.route, "direct");
  assert.equal(result.items.length, 1);
});
