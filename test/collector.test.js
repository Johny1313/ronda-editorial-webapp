import assert from "node:assert/strict";
import test from "node:test";
import { collectRound } from "../src/collector.js";

const now = new Date("2026-07-22T12:00:00Z");
const fallbackXml = `<rss><channel>
  <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://portal.test/a</link><pubDate>Wed, 22 Jul 2026 11:50:00 GMT</pubDate></item>
  <item><title>Plano de mobilidade urbana é anunciado pela prefeitura</title><link>https://portal.test/b</link><pubDate>Wed, 22 Jul 2026 11:45:00 GMT</pubDate></item>
</channel></rss>`;

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
});

test("falha de todas as fontes retorna diagnóstico estruturado", async () => {
  const feed = { id: "falha", name: "Falha", urls: ["https://fail.test/rss"] };
  const result = await collectRound({ fetcher: async () => new Response("erro", { status: 500 }), now, feeds: [feed] });
  assert.equal(result.ok, false);
  assert.equal(result.sources[0].ok, false);
  assert.match(result.error, /Nenhuma fonte/);
});
