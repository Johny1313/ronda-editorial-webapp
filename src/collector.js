import { buildTopics, clusterItems, titleTokens } from "./clustering.js";
import { parseFeed, plainText, stableHash } from "./parser.js";

export const FEEDS = Object.freeze([
  {
    id: "g1",
    name: "G1",
    urls: [
      "https://g1.globo.com/rss/g1/",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AG1&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "folha",
    name: "Folha de S.Paulo",
    urls: [
      "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AFolha_de_S.Paulo&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "uol",
    name: "UOL",
    urls: [
      "https://rss.uol.com.br/feed/noticias.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AUOL&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "estadao",
    name: "Estadão",
    urls: [
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AEstad%C3%A3o&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
      "https://news.google.com/rss/search?q=when%3A1d%20Estad%C3%A3o&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "agencia-brasil",
    name: "Agência Brasil",
    urls: [
      "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3AAg%C3%AAncia_Brasil&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "bbc-brasil",
    name: "BBC News Brasil",
    urls: [
      "https://feeds.bbci.co.uk/portuguese/rss.xml",
      "https://news.google.com/rss/search?q=when%3A1d%20source%3ABBC_News_Brasil&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    ],
  },
  {
    id: "outros-portais",
    name: "Outros portais",
    urls: ["https://news.google.com/rss/search?q=when%3A1d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419"],
  },
]);

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  return message.replace(/\s+/g, " ").trim().slice(0, 150);
}

async function fetchWithTimeout(url, fetcher, { accept, timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite excedido"), timeoutMs);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: accept ?? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectFeed(feed, cutoff, fetcher = fetch) {
  const errors = [];
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      const response = await fetchWithTimeout(url, fetcher);
      const xml = await response.text();
      const items = parseFeed(xml, feed, cutoff, 35);
      if (!items.length) throw new Error("Feed sem conteúdo válido nas últimas 24 horas");
      return {
        items,
        status: {
          id: feed.id,
          name: feed.name,
          ok: true,
          count: items.length,
          error: null,
          fallback: index > 0,
        },
      };
    } catch (error) {
      errors.push(compactError(error));
    }
  }
  return {
    items: [],
    status: {
      id: feed.id,
      name: feed.name,
      ok: false,
      count: 0,
      error: [...new Set(errors)].slice(0, 2).join(" | ") || "Fonte indisponível",
      fallback: false,
    },
  };
}

export function uniqueItems(items, limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function blueskyItem(post, cutoff) {
  const text = plainText(post?.record?.text);
  const publishedAtValue = post?.record?.createdAt || post?.indexedAt;
  const timestamp = Date.parse(publishedAtValue);
  const handle = plainText(post?.author?.handle);
  const rkey = String(post?.uri ?? "").split("/").filter(Boolean).at(-1);
  if (!text || !handle || !rkey || !Number.isFinite(timestamp) || timestamp < cutoff.getTime()) return null;
  const comments = positiveNumber(post.replyCount);
  const likes = positiveNumber(post.likeCount);
  const reposts = positiveNumber(post.repostCount);
  const quotes = positiveNumber(post.quoteCount);
  return {
    id: `bsky-${stableHash(post.uri)}`,
    title: text.slice(0, 210),
    description: "",
    sourceName: plainText(post?.author?.displayName) || `@${handle}`,
    collectorName: "Bluesky",
    platform: "Bluesky",
    kind: "social",
    publishedAt: new Date(timestamp).toISOString(),
    url: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`,
    views: null,
    comments,
    likes,
    interactions: comments + likes + reposts + quotes,
  };
}

export async function collectBluesky(initialClusters, cutoff, fetcher = fetch) {
  const queries = [];
  for (const cluster of initialClusters.slice(0, 5)) {
    const first = cluster.items[0];
    const query = titleTokens(first?.title ?? "").slice(0, 3).join(" ");
    if (query && !queries.includes(query)) queries.push(query);
  }
  if (!queries.length) {
    return { items: [], status: { id: "bluesky", name: "Bluesky", ok: true, count: 0, error: null, fallback: false } };
  }

  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=8&sort=latest`;
      const response = await fetchWithTimeout(endpoint, fetcher, { accept: "application/json", timeoutMs: 12_000 });
      const payload = await response.json();
      return Array.isArray(payload?.posts) ? payload.posts : [];
    }),
  );

  const items = [];
  const errors = [];
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(compactError(result.reason));
      continue;
    }
    for (const post of result.value) {
      const item = blueskyItem(post, cutoff);
      if (item) items.push(item);
    }
  }
  const unique = uniqueItems(items, 35);
  const allFailed = results.length > 0 && results.every((result) => result.status === "rejected");
  return {
    items: unique,
    status: {
      id: "bluesky",
      name: "Bluesky",
      ok: !allFailed,
      count: unique.length,
      error: allFailed ? [...new Set(errors)].slice(0, 2).join(" | ") : null,
      fallback: false,
    },
  };
}

export async function collectRound({ fetcher = fetch, now = new Date(), feeds = FEEDS } = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const portalResults = await Promise.all(feeds.map((feed) => collectFeed(feed, cutoff, fetcher)));
  const portalItems = uniqueItems(portalResults.flatMap((result) => result.items), 180);
  const portalStatuses = portalResults.map((result) => result.status);

  if (!portalItems.length) {
    return {
      ok: false,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conteúdo válido nas últimas 24 horas.",
      sources: portalStatuses,
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
      items: [],
      topics: [],
    };
  }

  const initialClusters = clusterItems(portalItems);
  const social = await collectBluesky(initialClusters, cutoff, fetcher);
  const allItems = uniqueItems([...portalItems, ...social.items]);
  const topics = buildTopics(allItems, collectedAt, 40);
  const sourceCount = new Set(allItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = allItems.filter((item) => item.kind === "social").length;

  return {
    ok: true,
    collectedAt: collectedAt.toISOString(),
    windowHours: 24,
    durationMs: Date.now() - startedAt,
    sources: [...portalStatuses, social.status],
    totals: {
      items: allItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
    },
    items: allItems,
    topics,
  };
}
