import assert from "node:assert/strict";
import test from "node:test";
import { collectFeed, collectRound, FEED_COUNTS, FEEDS } from "../src/collector.js";

const now = new Date("2026-07-22T12:00:00Z");
const fallbackXml = `<rss><channel>
  <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://portal.test/a</link><pubDate>Wed, 22 Jul 2026 11:50:00 GMT</pubDate></item>
  <item><title>Plano de mobilidade urbana é anunciado pela prefeitura</title><link>https://portal.test/b</link><pubDate>Wed, 22 Jul 2026 11:45:00 GMT</pubDate></item>
</channel></rss>`;

test("catálogo contém 17 portais do Brasil e 13 do Mundo", () => {
  assert.equal(FEEDS.length, 30);
  assert.deepEqual(FEED_COUNTS, { Brasil: 17, Mundo: 13, total: 30 });
  assert.equal(new Set(FEEDS.map((feed) => feed.id)).size, 30);
  assert.equal(new Set(FEEDS.map((feed) => feed.name)).size, 30);
  assert.ok(FEEDS.every((feed) => feed.canonicalSource && feed.urls.length >= 1));
  assert.ok(FEEDS.some((feed) => feed.name === "Metrópoles"));
  assert.ok(FEEDS.some((feed) => feed.name === "Canaltech"));
  assert.ok(FEEDS.some((feed) => feed.name === "TecMundo"));
  assert.ok(FEEDS.some((feed) => feed.name === "ABC News Australia"));
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
