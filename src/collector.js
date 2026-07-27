import { buildTopics, clusterItems, titleTokens } from "./clustering.js";
import { parseFeed, plainText, stableHash } from "./parser.js";

function googleNewsSource(source, region = "Brasil") {
  const locale = region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
  const query = encodeURIComponent(`when:1d source:${source.replace(/\s+/g, "_")}`);
  return `https://news.google.com/rss/search?q=${query}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function googleNewsSiteSource(value, region = "Brasil") {
  const locale = region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
  let hostname = "";
  try { hostname = new URL(String(value || "")).hostname.replace(/^www\./, ""); } catch {}
  const query = encodeURIComponent(`when:1d site:${hostname}`);
  return `https://news.google.com/rss/search?q=${query}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function googleNewsSitesSource(sites = [], region = "Brasil") {
  const locale = region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
  const clauses = [...new Set((Array.isArray(sites) ? sites : [])
    .map((site) => String(site || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, ""))
    .filter(Boolean))]
    .map((site) => `site:${site}`);
  const query = encodeURIComponent(`when:1d (${clauses.join(" OR ")})`);
  return `https://news.google.com/rss/search?q=${query}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function googleNewsTermSource(term) {
  const query = encodeURIComponent(`when:1d "${plainText(term).replace(/"/g, "")}"`);
  return `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=${encodeURIComponent("BR:pt-419")}`;
}

function looksLikeFeedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /(?:rss|feed|atom|xml|mrss)(?:[./?=&_-]|$)/i.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

export function customSourceFeed(source) {
  const url = String(source?.url || "").trim();
  const region = source?.region === "Mundo" ? "Mundo" : "Brasil";
  const googleFallback = googleNewsSiteSource(url, region);
  return Object.freeze({
    id: `custom-${source?.id || stableHash(url)}`,
    name: plainText(source?.name) || "Site cadastrado",
    region,
    canonicalSource: true,
    custom: true,
    limit: region === "Mundo" ? 8 : 15,
    urls: Object.freeze([looksLikeFeedUrl(url) ? url : null, googleFallback].filter(Boolean)),
  });
}

function feed(id, name, region, primaryUrl, googleSource = name) {
  return Object.freeze({
    id,
    name,
    region,
    canonicalSource: true,
    limit: region === "Mundo" ? 8 : 15,
    urls: Object.freeze([primaryUrl, googleNewsSource(googleSource, region)].filter(Boolean)),
  });
}

function sharedGooglePortalFeed(id, name, searchUrl, sourceAliases, editorialHints = []) {
  return Object.freeze({
    id,
    name,
    region: "Brasil",
    canonicalSource: true,
    limit: 15,
    scanLimit: 180,
    sourceAliases: Object.freeze(sourceAliases),
    editorialHints: Object.freeze(editorialHints),
    urls: Object.freeze([searchUrl]),
  });
}

const ENTERTAINMENT_PORTALS_SEARCH = googleNewsSitesSource([
  "portalleodias.com",
  "revistaquem.globo.com",
  "caras.com.br",
  "contigo.com.br",
  "otvfoco.com.br",
  "purepeople.com.br",
  "observatoriodosfamosos.uol.com.br",
  "jc.uol.com.br/social1/celebridades/observatorio-dos-famosos",
  "areavip.com.br",
  "natelinha.uol.com.br",
]);

const SPLASH_SEARCH = googleNewsSitesSource(["uol.com.br/splash"]);

const CURIOSITY_PORTALS_SEARCH = googleNewsSitesSource([
  "fatosdesconhecidos.com.br",
  "megacurioso.com.br",
  "hypeness.com.br",
  "incrivel.club",
  "misteriosdomundo.com.br",
  "super.abril.com.br",
  "revistagalileu.globo.com",
  "segredosdomundo.r7.com",
  "awebic.com.br",
]);

const CANALTECH_CURIOSIDADES_SEARCH = googleNewsSitesSource(["canaltech.com.br/curiosidades"]);

export const FEEDS = Object.freeze([
  // Brasil — 37 portais
  feed("g1", "G1", "Brasil", "https://g1.globo.com/rss/g1/"),
  feed("cnn-brasil", "CNN Brasil", "Brasil", "https://www.cnnbrasil.com.br/feed/", "CNN Brasil"),
  feed("folha", "Folha de S.Paulo", "Brasil", "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", "Folha de S.Paulo"),
  feed("estadao", "Estadão", "Brasil", null, "Estadão"),
  feed("o-globo", "O Globo", "Brasil", "https://oglobo.globo.com/rss.xml", "O Globo"),
  feed("veja", "Veja", "Brasil", "https://veja.abril.com.br/feed/"),
  feed("poder360", "Poder360", "Brasil", "https://www.poder360.com.br/feed/"),
  feed("agencia-brasil", "Agência Brasil", "Brasil", "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", "Agência Brasil"),
  feed("nexo", "Nexo Jornal", "Brasil", null, "Nexo Jornal"),
  feed("infomoney", "InfoMoney", "Brasil", "https://www.infomoney.com.br/feed/"),
  feed("money-times", "Money Times", "Brasil", "https://www.moneytimes.com.br/feed/", "Money Times"),
  feed("ge", "ge", "Brasil", "https://ge.globo.com/rss/ge/", "ge"),
  feed("canaltech", "Canaltech", "Brasil", "https://feeds2.feedburner.com/canaltechbr", "Canaltech"),
  feed("tecmundo", "TecMundo", "Brasil", "https://www.tecmundo.com.br/rss", "TecMundo"),
  feed("o-liberal", "O Liberal", "Brasil", "https://www.oliberal.com/rss", "O Liberal"),
  feed("metropoles", "Metrópoles", "Brasil", "https://www.metropoles.com/feed", "Metrópoles"),
  feed("campo-grande-news", "Campo Grande News", "Brasil", "https://www.campograndenews.com.br/rss", "Campo Grande News"),

  // Brasil — entretenimento, celebridades, realities, curiosidades e ciência pop
  sharedGooglePortalFeed("uol-splash", "UOL Splash", SPLASH_SEARCH, ["UOL Splash", "Splash", "UOL"], ["Fofoca e Celebridades", "Reality Shows", "Entretenimento"]),
  sharedGooglePortalFeed("leo-dias", "LeoDias", ENTERTAINMENT_PORTALS_SEARCH, ["LeoDias", "Portal LeoDias", "Leo Dias"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("quem", "Quem", ENTERTAINMENT_PORTALS_SEARCH, ["Quem", "Revista Quem"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("caras-brasil", "Caras Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Caras Brasil", "CARAS Brasil", "Caras"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("contigo", "Contigo!", ENTERTAINMENT_PORTALS_SEARCH, ["Contigo!", "Contigo"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("tv-foco", "TV Foco", ENTERTAINMENT_PORTALS_SEARCH, ["TV Foco", "O TV Foco", "TVFoco"], ["Entretenimento", "Reality Shows"]),
  sharedGooglePortalFeed("purepeople-brasil", "Purepeople Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Purepeople Brasil", "Purepeople"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("observatorio-dos-famosos", "Observatório dos Famosos", ENTERTAINMENT_PORTALS_SEARCH, ["Observatório dos Famosos", "Observatorio dos Famosos", "JC"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("area-vip", "Área VIP", ENTERTAINMENT_PORTALS_SEARCH, ["Área VIP", "Area VIP", "Área Vip"], ["Reality Shows", "Fofoca e Celebridades"]),
  sharedGooglePortalFeed("natelinha", "NaTelinha", ENTERTAINMENT_PORTALS_SEARCH, ["NaTelinha", "Na Telinha"], ["Reality Shows", "Entretenimento"]),
  sharedGooglePortalFeed("fatos-desconhecidos", "Fatos Desconhecidos", CURIOSITY_PORTALS_SEARCH, ["Fatos Desconhecidos"], ["Conteúdo Viral e Redes Sociais", "Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("mega-curioso", "Mega Curioso", CURIOSITY_PORTALS_SEARCH, ["Mega Curioso", "MegaCurioso"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("hypeness", "Hypeness", CURIOSITY_PORTALS_SEARCH, ["Hypeness"], ["Conteúdo Viral e Redes Sociais"]),
  sharedGooglePortalFeed("incrivel-club", "Incrível.club", CURIOSITY_PORTALS_SEARCH, ["Incrível.club", "Incrivel.club", "Incrível Club"], ["Conteúdo Viral e Redes Sociais"]),
  sharedGooglePortalFeed("misterios-do-mundo", "Mistérios do Mundo", CURIOSITY_PORTALS_SEARCH, ["Mistérios do Mundo", "Misterios do Mundo"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("canaltech-curiosidades", "Canaltech Curiosidades", CANALTECH_CURIOSIDADES_SEARCH, ["Canaltech"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("superinteressante", "Superinteressante", CURIOSITY_PORTALS_SEARCH, ["Superinteressante", "Super Interessante"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("revista-galileu", "Revista Galileu", CURIOSITY_PORTALS_SEARCH, ["Galileu", "Revista Galileu"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("segredos-do-mundo", "Segredos do Mundo", CURIOSITY_PORTALS_SEARCH, ["Segredos do Mundo", "R7.com", "R7"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("awebic", "Awebic", CURIOSITY_PORTALS_SEARCH, ["Awebic"], ["Curiosidades e Ciência Pop", "Conteúdo Viral e Redes Sociais"]),

  // Mundo — 13 portais
  feed("bbc", "BBC News", "Mundo", "https://feeds.bbci.co.uk/news/world/rss.xml", "BBC"),
  feed("guardian", "The Guardian", "Mundo", "https://www.theguardian.com/world/rss", "The Guardian"),
  feed("cnn", "CNN", "Mundo", "https://rss.cnn.com/rss/edition_world.rss", "CNN"),
  feed("new-york-times", "The New York Times", "Mundo", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "The New York Times"),
  feed("washington-post", "The Washington Post", "Mundo", "https://feeds.washingtonpost.com/rss/world", "The Washington Post"),
  feed("al-jazeera", "Al Jazeera", "Mundo", "https://www.aljazeera.com/xml/rss/all.xml", "Al Jazeera"),
  feed("france-24", "France 24", "Mundo", "https://www.france24.com/en/rss", "France 24"),
  feed("deutsche-welle", "Deutsche Welle", "Mundo", "https://rss.dw.com/rdf/rss-en-world", "Deutsche Welle"),
  feed("el-pais", "El País", "Mundo", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "El País"),
  feed("euronews", "Euronews", "Mundo", "https://www.euronews.com/rss?format=mrss&level=theme&name=news", "Euronews"),
  feed("cbc", "CBC News", "Mundo", "https://www.cbc.ca/cmlink/rss-world", "CBC News"),
  feed("abc-australia", "ABC News Australia", "Mundo", "https://www.abc.net.au/news/feed/51120/rss.xml", "ABC News"),
  feed("infobae", "Infobae", "Mundo", "https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml", "Infobae"),
]);

export const FEED_COUNTS = Object.freeze({
  Brasil: FEEDS.filter((item) => item.region === "Brasil").length,
  Mundo: FEEDS.filter((item) => item.region === "Mundo").length,
  total: FEEDS.length,
});

const PORTAL_SUBREQUEST_LIMIT = 38;
const TERM_SUBREQUEST_LIMIT = 6;

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  return message.replace(/\s+/g, " ").trim().slice(0, 150);
}

function sharedResponseFetcher(fetcher) {
  const pending = new Map();
  return async (url, options = {}) => {
    const key = `${String(options?.method || "GET").toUpperCase()} ${String(url)}`;
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const response = await fetcher(url, options);
        const body = new Uint8Array(await response.arrayBuffer());
        return {
          body,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
        };
      })());
    }
    const snapshot = await pending.get(key);
    return new Response(snapshot.body.slice(), {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
    });
  };
}

function reserveExternalRequest(requestBudget, url) {
  if (!requestBudget) return;
  requestBudget.seenUrls ||= new Set();
  const key = String(url);
  if (requestBudget.seenUrls.has(key)) return;
  if (requestBudget.remaining <= 0) throw new Error("Limite seguro de consultas externas atingido");
  requestBudget.seenUrls.add(key);
  requestBudget.remaining -= 1;
}

async function fetchWithTimeout(url, fetcher, { accept, timeoutMs = 8_000 } = {}) {
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

function normalizeCharset(value) {
  const charset = String(value || "").trim().replace(/["']/g, "").toLowerCase();
  if (["iso-8859-1", "latin1", "latin-1", "windows-1252", "cp1252"].includes(charset)) return "windows-1252";
  if (["utf8", "utf-8"].includes(charset)) return "utf-8";
  if (["utf-16", "utf-16le", "utf-16be"].includes(charset)) return charset;
  return "utf-8";
}

export async function decodeFeedResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "";
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];
  const declarationSample = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declarationCharset = /<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i.exec(declarationSample)?.[1];
  return new TextDecoder(normalizeCharset(headerCharset || declarationCharset)).decode(bytes);
}

export async function collectFeed(feed, cutoff, fetcher = fetch, requestBudget = null) {
  const errors = [];
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      reserveExternalRequest(requestBudget, url);
      const response = await fetchWithTimeout(url, fetcher);
      const xml = await decodeFeedResponse(response);
      const items = parseFeed(xml, feed, cutoff, Number(feed.limit) || 15);
      if (!items.length) throw new Error("Feed sem conteúdo válido nas últimas 24 horas");
      return {
        items,
        status: {
          id: feed.id,
          name: feed.name,
          region: feed.region || "Brasil",
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
      region: feed.region || "Brasil",
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

export async function collectDedicatedMonitoring(terms = [], cutoff, fetcher = fetch) {
  const activeTerms = (Array.isArray(terms) ? terms : [])
    .filter((item) => item?.id && plainText(item?.term))
    .slice(0, TERM_SUBREQUEST_LIMIT);
  if (!activeTerms.length) {
    return {
      enabled: false,
      terms: [],
      items: [],
      statuses: [],
      totals: { terms: 0, items: 0, sources: 0 },
    };
  }
  const requestBudget = { remaining: TERM_SUBREQUEST_LIMIT };
  const results = await Promise.all(activeTerms.map(async (term) => {
    const termFeed = {
      id: `term-${term.id}`,
      name: `Monitoramento: ${plainText(term.term)}`,
      region: "Brasil",
      canonicalSource: false,
      limit: 12,
      urls: [googleNewsTermSource(term.term)],
    };
    const result = await collectFeed(termFeed, cutoff, fetcher, requestBudget);
    return {
      term,
      status: {
        ...result.status,
        termId: term.id,
        term: plainText(term.term),
      },
      items: result.items.map((item) => ({
        ...item,
        kind: "monitoring",
        platform: "Monitoramento",
        monitoringTermId: term.id,
        monitoringTerm: plainText(term.term),
        matchedTerms: [{ id: term.id, term: plainText(term.term) }],
      })),
    };
  }));

  const byUrl = new Map();
  for (const result of results) {
    for (const item of result.items) {
      const existing = byUrl.get(item.url);
      if (!existing) {
        byUrl.set(item.url, item);
        continue;
      }
      const matchedTerms = [...(existing.matchedTerms || [])];
      for (const matched of item.matchedTerms || []) {
        if (!matchedTerms.some((value) => value.id === matched.id)) matchedTerms.push(matched);
      }
      byUrl.set(item.url, { ...existing, matchedTerms });
    }
  }
  const items = [...byUrl.values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 72);
  return {
    enabled: true,
    terms: activeTerms.map((item) => ({ id: item.id, term: plainText(item.term) })),
    items,
    statuses: results.map((result) => result.status),
    totals: {
      terms: activeTerms.length,
      items: items.length,
      sources: new Set(items.map((item) => item.sourceName).filter(Boolean)).size,
    },
  };
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
    region: "Rede",
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
    return { items: [], status: { id: "bluesky", name: "Bluesky", region: "Rede", ok: true, count: 0, error: null, fallback: false } };
  }

  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=8&sort=latest`;
      const response = await fetchWithTimeout(endpoint, fetcher, { accept: "application/json", timeoutMs: 6_500 });
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
      region: "Rede",
      ok: !allFailed,
      count: unique.length,
      error: allFailed ? [...new Set(errors)].slice(0, 2).join(" | ") : null,
      fallback: false,
    },
  };
}

export async function collectRound({ fetcher = fetch, now = new Date(), feeds = FEEDS, monitoringTerms = [] } = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const requestBudget = { remaining: PORTAL_SUBREQUEST_LIMIT, seenUrls: new Set() };
  const portalFetcher = sharedResponseFetcher(fetcher);
  const [portalResults, dedicatedMonitoring] = await Promise.all([
    Promise.all(feeds.map((feed) => collectFeed(feed, cutoff, portalFetcher, requestBudget))),
    collectDedicatedMonitoring(monitoringTerms, cutoff, fetcher),
  ]);
  const portalItems = uniqueItems(portalResults.flatMap((result) => result.items), 435);
  const portalStatuses = portalResults.map((result) => result.status);

  if (!portalItems.length) {
    return {
      ok: false,
      collectedAt: collectedAt.toISOString(),
      windowHours: 24,
      durationMs: Date.now() - startedAt,
      error: "Nenhuma fonte respondeu com conteúdo válido nas últimas 24 horas.",
      sources: portalStatuses,
      totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: dedicatedMonitoring.items.length },
      items: [],
      topics: [],
      dedicatedMonitoring,
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
      dedicatedItems: dedicatedMonitoring.items.length,
    },
    items: allItems,
    topics,
    dedicatedMonitoring,
  };
}
