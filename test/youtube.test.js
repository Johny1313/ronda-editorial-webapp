import assert from "node:assert/strict";
import test from "node:test";
import {
  applyYouTubeQuotaEvents,
  buildYouTubeCollection,
  calculateYouTubeAttention,
  defaultYouTubeQuotaState,
  extractYouTubeTopics,
  filterYouTubeNewsVideos,
  isApprovedYouTubeNewsChannel,
  normalizeYouTubeVideo,
  publicYouTubeQuota,
  restrictYouTubeCollectionToNews,
  restrictYouTubeTermResultToNews,
} from "../src/youtube.js";
import {
  compactYouTubeCollectionForStorage,
  compactYouTubeTermResultForStorage,
  isD1StorageLimitError,
} from "../src/database.js";

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


test("aceita somente canais jornalísticos aprovados", () => {
  assert.equal(isApprovedYouTubeNewsChannel("CNN Brasil"), true);
  assert.equal(isApprovedYouTubeNewsChannel("g1"), true);
  assert.equal(isApprovedYouTubeNewsChannel("Canal de Games do João"), false);
  const mixed = [
    { ...normalized[0], channel: "CNN Brasil" },
    { ...normalized[1], channel: "Canal de Games do João" },
    { ...normalized[2], channel: "Band Jornalismo" },
  ];
  assert.deepEqual(filterYouTubeNewsVideos(mixed).map((video) => video.channel), ["CNN Brasil", "Band Jornalismo"]);
});


test("aceita aliases jornalísticos e categoria News & Politics sem liberar creators genéricos", () => {
  assert.equal(isApprovedYouTubeNewsChannel({ channel: "CNN Brasil Ao Vivo", categoryId: "25" }), true);
  assert.equal(isApprovedYouTubeNewsChannel({ channel: "Jornal da Cidade", categoryId: "25" }), true);
  assert.equal(isApprovedYouTubeNewsChannel({ channel: "Canal de Games News", categoryId: "25" }), false);
  assert.equal(isApprovedYouTubeNewsChannel({ channel: "Opinião do João", categoryId: "25" }), false);
});

test("filtra snapshots antigos e resultados de termos para news only", () => {
  const mixed = calculateYouTubeAttention([
    { ...normalized[0], channel: "CNN Brasil", channelId: "cnn" },
    { ...normalized[1], channel: "Creator Aleatório", channelId: "creator" },
    { ...normalized[2], channel: "Poder360", channelId: "poder360" },
  ]);
  const oldCollection = buildYouTubeCollection(mixed, { region: "BR", collectedAt: "2026-07-27T18:00:00Z" });
  const newsCollection = restrictYouTubeCollectionToNews(oldCollection);
  assert.equal(newsCollection.newsOnly, true);
  assert.equal(newsCollection.stats.videoCount, 2);
  assert.deepEqual(newsCollection.videos.map((video) => video.channel).sort(), ["CNN Brasil", "Poder360"]);

  const term = restrictYouTubeTermResultToNews({
    id: "term-old",
    term: "eleições",
    videos: mixed,
    summary: {},
  });
  assert.equal(term.summary.videoCount, 2);
  assert.equal(term.videos.some((video) => video.channel === "Creator Aleatório"), false);
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


test("compacta payload do YouTube antes de gravar no D1", () => {
  const verbose = calculateYouTubeAttention(normalized.map((video) => ({
    ...video,
    description: "Descrição extensa ".repeat(500),
    tags: Array.from({ length: 80 }, (_, index) => `tag-${index}`),
  })));
  const collection = buildYouTubeCollection(verbose, { region: "BR", collectedAt: "2026-07-27T18:00:00Z" });
  const compact = compactYouTubeCollectionForStorage(collection);
  assert.equal(compact.videos.length, 3);
  assert.equal("description" in compact.videos[0], false);
  assert.equal("tags" in compact.videos[0], false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(collection).length / 2);
  assert.ok(compact.topics.every((topic) => topic.videos.length <= 5));
});

test("resultado de termo armazena somente amostra compacta", () => {
  const videos = calculateYouTubeAttention(normalized);
  const result = compactYouTubeTermResultForStorage({
    id: "term-1",
    termId: "t1",
    term: "Lula",
    collectedAt: "2026-07-27T18:00:00Z",
    videos: [...videos, ...videos, ...videos, ...videos],
    summary: { videoCount: 12, views: 100, viewsPerHour: 20, comments: 5, topVideo: videos[0] },
  });
  assert.equal(result.videos.length, 3);
  assert.equal(result.summary.videoCount, 12);
  assert.equal("description" in result.summary.topVideo, false);
});

test("reconhece erro de limite de tamanho do D1", () => {
  assert.equal(isD1StorageLimitError(new Error("D1_ERROR: Exceeded maximum DB size")), true);
  assert.equal(isD1StorageLimitError(new Error("Network connection lost")), false);
});
