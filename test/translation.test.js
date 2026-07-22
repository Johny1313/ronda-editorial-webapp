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

test("traduz títulos e descrições internacionais para português", async () => {
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
  assert.equal(result.translatedItems[0].description, "A reunião discute um novo acordo.");
  assert.equal(result.translatedItems[0].targetLanguage, "pt-BR");
  assert.equal(result.translatedItems[0].translationStatus, "translated");
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

