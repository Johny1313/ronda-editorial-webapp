import assert from "node:assert/strict";
import test from "node:test";
import { decodeEntities, parseFeed, plainText, stableHash } from "../src/parser.js";

test("decodifica entidades e remove HTML", () => {
  assert.equal(decodeEntities("A &amp; B &#33;"), "A & B !");
  assert.equal(plainText("<![CDATA[<b>Texto</b> &amp; mais]]>"), "Texto & mais");
});

test("lê RSS 2.0 e respeita a janela de 24 horas", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const xml = `<rss><channel>
    <item><title>Matéria &amp; teste</title><link>https://example.com/a</link><pubDate>Wed, 22 Jul 2026 11:00:00 GMT</pubDate><description><![CDATA[<p>Resumo</p>]]></description></item>
    <item><title>Antiga</title><link>https://example.com/old</link><pubDate>Mon, 20 Jul 2026 11:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = parseFeed(xml, { id: "fonte", name: "Fonte" }, new Date(now.getTime() - 86_400_000));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Matéria & teste");
  assert.equal(items[0].description, "Resumo");
  assert.equal(items[0].url, "https://example.com/a");
});

test("lê Atom com link em atributo href", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Entrada Atom</title><link rel="alternate" href="https://example.com/atom"/><updated>2026-07-22T11:30:00Z</updated><summary>Resumo Atom</summary></entry></feed>`;
  const items = parseFeed(xml, { id: "atom", name: "Atom" }, new Date("2026-07-21T12:00:00Z"));
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/atom");
  assert.match(items[0].id, /^rss-atom-/);
});

test("mantém o nome canônico e a região do portal em feeds agregados", () => {
  const xml = `<rss><channel><item><title>Notícia internacional</title><link>https://example.com/world</link><pubDate>Wed, 22 Jul 2026 11:30:00 GMT</pubDate><source>Nome variável do agregador</source></item></channel></rss>`;
  const items = parseFeed(xml, { id: "bbc", name: "BBC News", region: "Mundo", canonicalSource: true }, new Date("2026-07-21T12:00:00Z"));
  assert.equal(items[0].sourceName, "BBC News");
  assert.equal(items[0].collectorName, "BBC News");
  assert.equal(items[0].region, "Mundo");
});

test("hash é estável", () => {
  assert.equal(stableHash("https://example.com"), stableHash("https://example.com"));
  assert.notEqual(stableHash("a"), stableHash("b"));
});
