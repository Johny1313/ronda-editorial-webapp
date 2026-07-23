import assert from "node:assert/strict";
import test from "node:test";
import { buildTopics, classifyEditoria, clusterItems, titleTokens, tokenSimilarity } from "../src/clustering.js";

const now = new Date("2026-07-22T12:00:00Z");
const base = { description: "", collectorName: "Teste", platform: "Portal", kind: "portal", views: null, comments: null, likes: null, interactions: null };
const items = [
  { ...base, id: "1", title: "Prefeitura anuncia plano de mobilidade urbana", sourceName: "Portal A", publishedAt: "2026-07-22T11:50:00Z", url: "https://a.test/1" },
  { ...base, id: "2", title: "Plano de mobilidade urbana é anunciado pela prefeitura", sourceName: "Portal B", publishedAt: "2026-07-22T11:40:00Z", url: "https://b.test/2" },
  { ...base, id: "3", title: "Seleção vence amistoso internacional", sourceName: "Portal C", publishedAt: "2026-07-22T11:30:00Z", url: "https://c.test/3" },
];

test("similaridade aproxima títulos do mesmo assunto", () => {
  const first = titleTokens(items[0].title);
  const second = titleTokens(items[1].title);
  assert.ok(tokenSimilarity(first, second) >= 0.36);
});

test("agrupa assuntos semelhantes sem unir temas diferentes", () => {
  const clusters = clusterItems(items);
  assert.equal(clusters.length, 2);
  assert.equal(clusters.find((cluster) => cluster.items.length === 2)?.items.length, 2);
});

test("gera cards editoriais ordenados", () => {
  const topics = buildTopics(items, now);
  assert.equal(topics.length, 2);
  assert.equal(topics[0].itemCount, 2);
  assert.equal(topics[0].sourceCount, 2);
  assert.ok(topics[0].recommendation.length > 20);
  assert.ok(topics.every((topic) => topic.editoria));
  assert.ok(topics.every((topic) => topic.carousel?.slides?.length === 5));
  assert.ok(topics.every((topic) => topic.carousel?.voiceTone && topic.carousel?.postModel));
  assert.ok(topics.every((topic) => topic.carousel?.language === "pt-BR"));
  assert.ok(topics.every((topic) => topic.carousel?.verificationLinks?.length >= 1));
  assert.ok(topics.every((topic) => !("imageSuggestions" in topic.carousel)));
  assert.ok(topics.every((topic) => topic.carousel.verificationLinks.every((link) => /^https?:\/\//i.test(link.url))));
  assert.deepEqual(
    new Set(topics[0].carousel.verificationLinks.map((link) => link.url)),
    new Set(topics[0].items.map((item) => item.url)),
  );
});

test("classifica assuntos nas editorias principais", () => {
  assert.equal(classifyEditoria([{ title: "Senado vota projeto do governo", description: "Congresso analisa proposta" }]), "Política");
  assert.equal(classifyEditoria([{ title: "Seleção vence jogo da Copa", description: "Jogador marcou dois gols" }]), "Esportes");
  assert.equal(classifyEditoria([{ title: "Atriz estreia nova série no streaming", description: "Produção chega ao cinema" }]), "Entretenimento");
  assert.equal(classifyEditoria([{ title: "Chuva muda trânsito na capital", description: "Avenida foi interditada" }]), "Notícias");
});
