import assert from "node:assert/strict";
import test from "node:test";
import {
  applyYouTubeQuotaEvents,
  buildYouTubeCollection,
  calculateYouTubeAttention,
  defaultYouTubeQuotaState,
  extractYouTubeTopics,
  normalizeYouTubeVideo,
  publicYouTubeQuota,
} from "../src/youtube.js";

const NOW = Date.parse("2026-07-27T18:00:00Z");

function apiVideo({ id, title, channel, publishedAt, views, likes, comments, tags = [] }) {
  return {
    id,
    snippet: {
      title,
      channelTitle: channel,
      channelId: `channel-${channel}`,
      publishedAt,
      tags,
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
    },
    statistics: {
      viewCount: String(views),
      likeCount: String(likes),
      commentCount: String(comments),
    },
    contentDetails: { duration: "PT12M30S" },
  };
}

const normalized = [
  apiVideo({ id: "a", title: "Entrevista de Lula repercute no Brasil", channel: "Canal A", publishedAt: "2026-07-27T17:00:00Z", views: 900000, likes: 70000, comments: 14000, tags: ["Lula", "Brasil", "política"] }),
  apiVideo({ id: "b", title: "Lula comenta relação entre Brasil e Coreia", channel: "Canal B", publishedAt: "2026-07-27T16:30:00Z", views: 620000, likes: 42000, comments: 9000, tags: ["Lula", "Brasil", "política"] }),
  apiVideo({ id: "c", title: "Análise do encontro de Lula com líderes", channel: "Canal C", publishedAt: "2026-07-27T15:30:00Z", views: 480000, likes: 28000, comments: 6200, tags: ["Lula", "governo"] }),
].map((item, index) => normalizeYouTubeVideo(item, index, NOW));

test("normaliza estatísticas e calcula velocidade por hora", () => {
  assert.equal(normalized[0].id, "a");
  assert.equal(normalized[0].durationSeconds, 750);
  assert.equal(normalized[0].viewsPerHour, 900000);
  assert.equal(normalized[0].url, "https://www.youtube.com/watch?v=a");
});

test("gera índice e decisão editorial sem depender de IA", () => {
  const ranked = calculateYouTubeAttention(normalized);
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].attentionIndex >= ranked[1].attentionIndex);
  assert.ok(["Possível viral", "Pautar agora", "Acompanhar", "Baixa prioridade"].includes(ranked[0].decision));
  assert.ok(ranked[0].reasons.length > 0);
});

test("agrupa assunto recorrente em vários canais", () => {
  const ranked = calculateYouTubeAttention(normalized);
  const topics = extractYouTubeTopics(ranked);
  assert.ok(topics.length > 0);
  const lula = topics.find((topic) => topic.label.toLowerCase().includes("lula"));
  assert.ok(lula);
  assert.equal(lula.channelCount, 3);
  assert.equal(lula.editoria, "Política");
});

test("coleção entrega cards, canais e alertas sem gráfico", () => {
  const collection = buildYouTubeCollection(normalized, { region: "BR", collectedAt: "2026-07-27T18:00:00Z" });
  assert.equal(collection.region, "BR");
  assert.equal(collection.stats.videoCount, 3);
  assert.ok(collection.topics.length > 0);
  assert.equal(collection.channels.length, 3);
  assert.ok(Array.isArray(collection.alerts));
  assert.equal("chart" in collection, false);
  assert.equal("series" in collection, false);
});

test("controla separadamente cota de busca e cota geral", () => {
  const initial = defaultYouTubeQuotaState("2026-07-27");
  const state = applyYouTubeQuotaEvents(initial, [
    { endpoint: "videos.list", bucket: "general", units: 1, calls: 1 },
    { endpoint: "search.list", bucket: "search", units: 1, calls: 1 },
    { endpoint: "videos.batchGetStats", bucket: "batchStats", units: 1, calls: 1 },
  ], "2026-07-27T18:00:00Z");
  const quota = publicYouTubeQuota(state);
  assert.equal(quota.general.used, 1);
  assert.equal(quota.search.used, 1);
  assert.equal(quota.search.remaining, 99);
  assert.equal(quota.batchStats.used, 1);
});
