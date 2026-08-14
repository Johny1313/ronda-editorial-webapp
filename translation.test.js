import assert from "node:assert/strict";
import test from "node:test";
import {
  isLikelyPortuguese,
  portugueseOnlyFallback,
  sourceLanguage,
  translateWorldItems,
  translationKey,
} from "../src/translation.js";

const base = {
  id: "world-1",
  sourceName: "BBC News",
  collectorName: "BBC News",
  region: "Mundo",
  kind: "portal",
  platform: "Portal",
  publishedAt: "2026-07-22T12:00:00Z",
  url: "https://example.com/world",
};

test("traduz o título internacional e usa conteúdo seguro em português", async () => {
  const dictionary = new Map([
    ["World leaders meet today", "Líderes mundiais se reúnem hoje"],
    ["The meeting discusses a new agreement.", "A reunião discute um novo acordo."],
  ]);
  const ai = { run: async (_model, input) => ({ translated_text: dictionary.get(input.text) }) };
  const result = await translateWorldItems([{
    ...base,
    title: "World leaders meet today",
    description: "The meeting discusses a new agreement.",
  }], { ai });

  assert.equal(result.omittedItems, 0);
  assert.equal(result.translatedItems[0].title, "Líderes mundiais se reúnem hoje");
  assert.equal(result.translatedItems[0].description, "Líderes mundiais se reúnem hoje");
  assert.equal(result.translatedItems[0].content, "Líderes mundiais se reúnem hoje");
  assert.equal(result.translatedItems[0].contentSource, "translated-title-safe-fallback");
  assert.equal(result.translatedItems[0].targetLanguage, "pt-BR");
  assert.equal(result.translatedItems[0].translationStatus, "title-only");
  assert.equal(result.generatedEntries.length, 1);
});

test("usa espanhol para El País e elimina item sem tradução", async () => {
  assert.equal(sourceLanguage({ collectorName: "El País" }), "es");
  assert.equal(sourceLanguage({ collectorName: "The Guardian" }), "en");
  const result = await translateWorldItems([{ ...base, title: "Untranslated headline", description: "" }], { ai: null });
  assert.equal(result.translatedItems.length, 0);
  assert.equal(result.omittedItems, 1);
});

test("fallback nunca mantém conteúdo Mundo ou rede em outro idioma", () => {
  const payload = {
    ok: true,
    collectedAt: "2026-07-22T12:00:00Z",
    sources: [],
    items: [
      { ...base, title: "English world headline", description: "English description" },
      { ...base, id: "br-1", region: "Brasil", collectorName: "G1", sourceName: "G1", title: "Notícia brasileira sobre política", description: "", url: "https://example.com/br" },
      { ...base, id: "social-en", region: "Rede", collectorName: "Bluesky", sourceName: "Conta", kind: "social", title: "Breaking news from abroad", description: "", url: "https://example.com/social-en" },
      { ...base, id: "social-pt", region: "Rede", collectorName: "Bluesky", sourceName: "Conta", kind: "social", title: "Notícia nova para o Brasil", description: "", url: "https://example.com/social-pt" },
    ],
  };
  const safe = portugueseOnlyFallback(payload);
  assert.equal(safe.items.some((item) => item.region === "Mundo"), false);
  assert.equal(safe.items.some((item) => item.id === "social-en"), false);
  assert.equal(safe.items.some((item) => item.id === "social-pt"), true);
  assert.equal(safe.translation.portugueseOnly, true);
});

test("chave de cache considera texto e idioma", () => {
  assert.equal(translationKey("Hello", "en"), translationKey("Hello", "en"));
  assert.notEqual(translationKey("Hello", "en"), translationKey("Hello", "es"));
  assert.equal(isLikelyPortuguese("Notícia importante para o Brasil"), true);
  assert.equal(isLikelyPortuguese("Breaking news abroad"), false);
});



test("limita novas traduções, prioriza uma manchete por fonte e reaproveita português", async () => {
  const items = [
    { ...base, id: "a1", collectorName: "BBC News", sourceName: "BBC News", title: "First English headline", description: "English details" },
    { ...base, id: "a2", collectorName: "BBC News", sourceName: "BBC News", title: "Second English headline", description: "More details" },
    { ...base, id: "b1", collectorName: "The Guardian", sourceName: "The Guardian", title: "Another English headline", description: "Details" },
    { ...base, id: "pt1", collectorName: "BBC News", sourceName: "BBC News", title: "Notícia importante para o Brasil", description: "Resumo em português" },
  ];
  const calls = [];
  const ai = { run: async (_model, input) => { calls.push(input.text); return { translated_text: `PT ${input.text}` }; } };
  const result = await translateWorldItems(items, { ai, maximumNewTitles: 2, concurrency: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls.includes("First English headline"));
  assert.ok(calls.includes("Another English headline"));
  assert.equal(result.translatedItems.some((item) => item.id === "pt1"), true);
  assert.equal(result.omittedItems, 1);
});


test("repete uma vez quando o tradutor devolve o texto original", async () => {
  let attempts = 0;
  const ai = { run: async (_model, input) => {
    attempts += 1;
    return { translated_text: attempts === 1 ? input.text : "Título traduzido para português" };
  } };
  const result = await translateWorldItems([{ ...base, title: "Original English headline", description: "Details" }], { ai, concurrency: 1 });
  assert.equal(attempts, 2);
  assert.equal(result.translatedItems[0].title, "Título traduzido para português");
});
