import { buildTopics, clusterItems, titleTokens } from "./clustering.js";
import { parseFeed, plainText, stableHash } from "./parser.js";

function googleLocale(region = "Brasil") {
  return region === "Brasil"
    ? { hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" }
    : { hl: "en-US", gl: "US", ceid: "US:en" };
}

function googleNewsQuerySource(query, region = "Brasil") {
  const locale = googleLocale(region);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function googleNewsSource(source, region = "Brasil") {
  return googleNewsQuerySource(`when:2d source:${String(source || "").replace(/\s+/g, "_")}`, region);
}

function normalizedSite(value) {
  try {
    return new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${String(value || "")}`)
      .hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

function googleNewsSiteSource(value, region = "Brasil", extraQuery = "", windowDays = 2) {
  const hostname = normalizedSite(value);
  const days = Math.min(30, Math.max(1, Math.round(Number(windowDays) || 2)));
  const query = [`when:${days}d`, hostname ? `site:${hostname}` : "", plainText(extraQuery)].filter(Boolean).join(" ");
  return googleNewsQuerySource(query, region);
}

function googleNewsSitesSource(sites = [], region = "Brasil", extraQuery = "") {
  const clauses = [...new Set((Array.isArray(sites) ? sites : []).map(normalizedSite).filter(Boolean))]
    .map((site) => `site:${site}`);
  const siteQuery = clauses.length > 1 ? `(${clauses.join(" OR ")})` : clauses[0] || "";
  return googleNewsQuerySource(["when:2d", siteQuery, plainText(extraQuery)].filter(Boolean).join(" "), region);
}

function googleNewsTermSource(term) {
  return googleNewsQuerySource(`when:1d "${plainText(term).replace(/"/g, "")}"`, "Brasil");
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
    directUrl: looksLikeFeedUrl(url) ? url : null,
    custom: true,
    limit: region === "Mundo" ? 8 : 15,
    sourceDomains: Object.freeze([normalizedSite(url)].filter(Boolean)),
    urls: Object.freeze([looksLikeFeedUrl(url) ? url : null, googleFallback].filter(Boolean)),
  });
}

function portalFeed(id, name, region, { primaryUrl = null, fallbackUrl = null, sourceAliases = [], sourceDomains = [], editorialHints = [], limit = null, scanLimit = 240, emptyIsHealthy = false } = {}) {
  return Object.freeze({
    id,
    name,
    region,
    canonicalSource: true,
    directUrl: primaryUrl || null,
    limit: limit || (region === "Mundo" ? 8 : 15),
    scanLimit,
    emptyIsHealthy: Boolean(emptyIsHealthy),
    sourceAliases: Object.freeze(sourceAliases),
    sourceDomains: Object.freeze(sourceDomains.map(normalizedSite).filter(Boolean)),
    editorialHints: Object.freeze(editorialHints),
    urls: Object.freeze([primaryUrl, fallbackUrl].filter(Boolean)),
  });
}

function sharedGooglePortalFeed(id, name, searchUrl, sourceAliases, sourceDomains, editorialHints = []) {
  return portalFeed(id, name, "Brasil", {
    fallbackUrl: searchUrl,
    sourceAliases,
    sourceDomains,
    editorialHints,
    scanLimit: 500,
  });
}

const CORE_BRASIL_DOMAINS = Object.freeze([
  "g1.globo.com", "cnnbrasil.com.br", "folha.uol.com.br", "estadao.com.br", "oglobo.globo.com",
  "veja.abril.com.br", "poder360.com.br", "agenciabrasil.ebc.com.br", "nexojornal.com.br",
  "infomoney.com.br", "moneytimes.com.br", "ge.globo.com", "canaltech.com.br", "tecmundo.com.br",
  "oliberal.com", "metropoles.com", "campograndenews.com.br",
]);
const CORE_BRASIL_FALLBACK = googleNewsSitesSource(CORE_BRASIL_DOMAINS, "Brasil");

const WORLD_DOMAINS = Object.freeze([
  "bbc.com", "theguardian.com", "cnn.com", "nytimes.com", "washingtonpost.com", "aljazeera.com",
  "france24.com", "dw.com", "elpais.com", "euronews.com", "cbc.ca", "abc.net.au", "infobae.com",
]);
const WORLD_FALLBACK = googleNewsSitesSource(WORLD_DOMAINS, "Mundo");

const ENTERTAINMENT_DOMAINS = Object.freeze([
  "portalleodias.com", "revistaquem.globo.com", "caras.com.br", "otvfoco.com.br",
  "purepeople.com.br", "areavip.com.br",
]);
const ENTERTAINMENT_PORTALS_SEARCH = googleNewsSitesSource(ENTERTAINMENT_DOMAINS, "Brasil");
const SPLASH_SEARCH = googleNewsSiteSource("uol.com.br", "Brasil", 'Splash entretenimento celebridades BBB');
const OBSERVATORIO_SEARCH = googleNewsSiteSource("jc.uol.com.br", "Brasil", '"Observatório dos Famosos"', 7);
const NATELINHA_SEARCH = googleNewsSiteSource("natelinha.uol.com.br", "Brasil");

const CURIOSITY_DOMAINS = Object.freeze([
  "fatosdesconhecidos.com.br", "megacurioso.com.br", "misteriosdomundo.org", "super.abril.com.br",
  "revistagalileu.globo.com", "segredosdomundo.r7.com", "awebic.com.br",
]);
const CURIOSITY_PORTALS_SEARCH = googleNewsSitesSource(CURIOSITY_DOMAINS, "Brasil");
const CANALTECH_CURIOSIDADES_SEARCH = googleNewsSiteSource("canaltech.com.br", "Brasil", "curiosidades ciência");
const INCRIVEL_SEARCH = googleNewsSiteSource("incrivel.club", "Brasil", "", 7);

export const FEEDS = Object.freeze([
  // Brasil — portais gerais. O segundo endereço é um fallback agregado e compartilhado.
  portalFeed("g1", "G1", "Brasil", { primaryUrl: "https://g1.globo.com/rss/g1/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["G1"], sourceDomains: ["g1.globo.com"] }),
  portalFeed("cnn-brasil", "CNN Brasil", "Brasil", { primaryUrl: "https://www.cnnbrasil.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["CNN Brasil"], sourceDomains: ["cnnbrasil.com.br"] }),
  portalFeed("folha", "Folha de S.Paulo", "Brasil", { primaryUrl: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Folha de S.Paulo", "Folha"], sourceDomains: ["folha.uol.com.br"] }),
  portalFeed("estadao", "Estadão", "Brasil", { fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Estadão", "O Estado de S. Paulo"], sourceDomains: ["estadao.com.br"] }),
  portalFeed("o-globo", "O Globo", "Brasil", { primaryUrl: "https://oglobo.globo.com/rss.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Globo"], sourceDomains: ["oglobo.globo.com"] }),
  portalFeed("veja", "Veja", "Brasil", { primaryUrl: "https://veja.abril.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Veja"], sourceDomains: ["veja.abril.com.br"] }),
  portalFeed("poder360", "Poder360", "Brasil", { primaryUrl: "https://www.poder360.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Poder360"], sourceDomains: ["poder360.com.br"] }),
  portalFeed("agencia-brasil", "Agência Brasil", "Brasil", { primaryUrl: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Agência Brasil"], sourceDomains: ["agenciabrasil.ebc.com.br"] }),
  portalFeed("nexo", "Nexo Jornal", "Brasil", { fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Nexo Jornal", "Nexo"], sourceDomains: ["nexojornal.com.br"] }),
  portalFeed("infomoney", "InfoMoney", "Brasil", { primaryUrl: "https://www.infomoney.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["InfoMoney"], sourceDomains: ["infomoney.com.br"] }),
  portalFeed("money-times", "Money Times", "Brasil", { primaryUrl: "https://www.moneytimes.com.br/feed/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Money Times"], sourceDomains: ["moneytimes.com.br"] }),
  portalFeed("ge", "ge", "Brasil", { primaryUrl: "https://ge.globo.com/rss/ge/", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["ge", "Globo Esporte"], sourceDomains: ["ge.globo.com"] }),
  portalFeed("canaltech", "Canaltech", "Brasil", { primaryUrl: "https://feeds2.feedburner.com/canaltechbr", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Canaltech"], sourceDomains: ["canaltech.com.br"] }),
  portalFeed("tecmundo", "TecMundo", "Brasil", { primaryUrl: "https://www.tecmundo.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["TecMundo"], sourceDomains: ["tecmundo.com.br"] }),
  portalFeed("o-liberal", "O Liberal", "Brasil", { primaryUrl: "https://www.oliberal.com/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["O Liberal"], sourceDomains: ["oliberal.com"] }),
  portalFeed("metropoles", "Metrópoles", "Brasil", { primaryUrl: "https://www.metropoles.com/feed", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Metrópoles", "Metropoles"], sourceDomains: ["metropoles.com"] }),
  portalFeed("campo-grande-news", "Campo Grande News", "Brasil", { primaryUrl: "https://www.campograndenews.com.br/rss", fallbackUrl: CORE_BRASIL_FALLBACK, sourceAliases: ["Campo Grande News"], sourceDomains: ["campograndenews.com.br"] }),

  // Brasil — entretenimento, celebridades, realities, curiosidades e ciência pop.
  sharedGooglePortalFeed("uol-splash", "UOL Splash", SPLASH_SEARCH, ["UOL", "UOL Splash", "Splash"], ["uol.com.br"], ["Fofoca e Celebridades", "Reality Shows", "Entretenimento"]),
  sharedGooglePortalFeed("leo-dias", "LeoDias", ENTERTAINMENT_PORTALS_SEARCH, ["LeoDias", "Portal LeoDias", "Leo Dias"], ["portalleodias.com"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("quem", "Quem", ENTERTAINMENT_PORTALS_SEARCH, ["Quem", "Revista Quem"], ["revistaquem.globo.com"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("caras-brasil", "Caras Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Caras Brasil", "CARAS Brasil", "Caras"], ["caras.com.br"], ["Fofoca e Celebridades"]),
  sharedGooglePortalFeed("tv-foco", "TV Foco", ENTERTAINMENT_PORTALS_SEARCH, ["TV Foco", "O TV Foco", "TVFoco"], ["otvfoco.com.br"], ["Entretenimento", "Reality Shows"]),
  sharedGooglePortalFeed("purepeople-brasil", "Purepeople Brasil", ENTERTAINMENT_PORTALS_SEARCH, ["Purepeople Brasil", "Purepeople"], ["purepeople.com.br"], ["Fofoca e Celebridades"]),
  portalFeed("observatorio-dos-famosos", "Observatório dos Famosos", "Brasil", { fallbackUrl: OBSERVATORIO_SEARCH, sourceAliases: ["Observatório dos Famosos", "Observatorio dos Famosos"], sourceDomains: ["jc.uol.com.br"], editorialHints: ["Fofoca e Celebridades"], scanLimit: 240, emptyIsHealthy: true }),
  sharedGooglePortalFeed("area-vip", "Área VIP", ENTERTAINMENT_PORTALS_SEARCH, ["Área VIP", "Area VIP", "Área Vip"], ["areavip.com.br"], ["Reality Shows", "Fofoca e Celebridades"]),
  sharedGooglePortalFeed("natelinha", "NaTelinha", NATELINHA_SEARCH, ["NaTelinha", "Na Telinha", "UOL"], ["natelinha.uol.com.br"], ["Reality Shows", "Entretenimento"]),
  sharedGooglePortalFeed("fatos-desconhecidos", "Fatos Desconhecidos", CURIOSITY_PORTALS_SEARCH, ["Fatos Desconhecidos"], ["fatosdesconhecidos.com.br"], ["Conteúdo Viral e Redes Sociais", "Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("mega-curioso", "Mega Curioso", CURIOSITY_PORTALS_SEARCH, ["Mega Curioso", "MegaCurioso"], ["megacurioso.com.br"], ["Curiosidades e Ciência Pop"]),
  portalFeed("incrivel-club", "Incrível.club", "Brasil", { fallbackUrl: INCRIVEL_SEARCH, sourceAliases: ["Incrível.club", "Incrivel.club", "Incrível Club"], sourceDomains: ["incrivel.club"], editorialHints: ["Conteúdo Viral e Redes Sociais"], scanLimit: 240, emptyIsHealthy: true }),
  portalFeed("misterios-do-mundo", "Mistérios do Mundo", "Brasil", { primaryUrl: "https://misteriosdomundo.org/feed/", fallbackUrl: CURIOSITY_PORTALS_SEARCH, sourceAliases: ["Mistérios do Mundo", "Misterios do Mundo"], sourceDomains: ["misteriosdomundo.org"], editorialHints: ["Curiosidades e Ciência Pop"], scanLimit: 240, emptyIsHealthy: true }),
  sharedGooglePortalFeed("canaltech-curiosidades", "Canaltech Curiosidades", CANALTECH_CURIOSIDADES_SEARCH, ["Canaltech"], ["canaltech.com.br"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("superinteressante", "Superinteressante", CURIOSITY_PORTALS_SEARCH, ["Superinteressante", "Super Interessante"], ["super.abril.com.br"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("revista-galileu", "Revista Galileu", CURIOSITY_PORTALS_SEARCH, ["Galileu", "Revista Galileu"], ["revistagalileu.globo.com"], ["Curiosidades e Ciência Pop"]),
  sharedGooglePortalFeed("segredos-do-mundo", "Segredos do Mundo", CURIOSITY_PORTALS_SEARCH, ["Segredos do Mundo", "R7.com", "R7"], ["segredosdomundo.r7.com"], ["Curiosidades e Ciência Pop"]),
  portalFeed("awebic", "Awebic", "Brasil", { fallbackUrl: CURIOSITY_PORTALS_SEARCH, sourceAliases: ["Awebic"], sourceDomains: ["awebic.com.br"], editorialHints: ["Curiosidades e Ciência Pop"], scanLimit: 500, emptyIsHealthy: true }),

  // Mundo — feeds oficiais com fallback agregado por domínio.
  portalFeed("bbc", "BBC News", "Mundo", { primaryUrl: "https://feeds.bbci.co.uk/news/world/rss.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["BBC", "BBC News"], sourceDomains: ["bbc.com"] }),
  portalFeed("guardian", "The Guardian", "Mundo", { primaryUrl: "https://www.theguardian.com/world/rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The Guardian", "Guardian"], sourceDomains: ["theguardian.com"] }),
  portalFeed("cnn", "CNN", "Mundo", { primaryUrl: "https://rss.cnn.com/rss/edition_world.rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["CNN"], sourceDomains: ["cnn.com"] }),
  portalFeed("new-york-times", "The New York Times", "Mundo", { primaryUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The New York Times", "New York Times"], sourceDomains: ["nytimes.com"] }),
  portalFeed("washington-post", "The Washington Post", "Mundo", { primaryUrl: "https://feeds.washingtonpost.com/rss/world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["The Washington Post", "Washington Post"], sourceDomains: ["washingtonpost.com"] }),
  portalFeed("al-jazeera", "Al Jazeera", "Mundo", { primaryUrl: "https://www.aljazeera.com/xml/rss/all.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Al Jazeera"], sourceDomains: ["aljazeera.com"] }),
  portalFeed("france-24", "France 24", "Mundo", { primaryUrl: "https://www.france24.com/en/rss", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["France 24"], sourceDomains: ["france24.com"] }),
  portalFeed("deutsche-welle", "Deutsche Welle", "Mundo", { primaryUrl: "https://rss.dw.com/rdf/rss-en-world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Deutsche Welle", "DW"], sourceDomains: ["dw.com"] }),
  portalFeed("el-pais", "El País", "Mundo", { primaryUrl: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["El País", "EL PAÍS"], sourceDomains: ["elpais.com"] }),
  portalFeed("euronews", "Euronews", "Mundo", { primaryUrl: "https://www.euronews.com/rss?format=mrss&level=theme&name=news", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Euronews"], sourceDomains: ["euronews.com"] }),
  portalFeed("cbc", "CBC News", "Mundo", { primaryUrl: "https://www.cbc.ca/cmlink/rss-world", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["CBC", "CBC News"], sourceDomains: ["cbc.ca"] }),
  portalFeed("abc-australia", "ABC News Australia", "Mundo", { primaryUrl: "https://www.abc.net.au/news/feed/51120/rss.xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["ABC News", "ABC News Australia"], sourceDomains: ["abc.net.au"] }),
  portalFeed("infobae", "Infobae", "Mundo", { primaryUrl: "https://www.infobae.com/arc/outboundfeeds/rss/?outputType=xml", fallbackUrl: WORLD_FALLBACK, sourceAliases: ["Infobae"], sourceDomains: ["infobae.com"] }),
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
  let successfulResponses = 0;
  const effectiveCutoff = cutoff;
  const windowHours = 24;
  for (let index = 0; index < feed.urls.length; index += 1) {
    const url = feed.urls[index];
    try {
      reserveExternalRequest(requestBudget, url);
      const response = await fetchWithTimeout(url, fetcher);
      successfulResponses += 1;
      const xml = await decodeFeedResponse(response);
      const direct = Boolean(feed.directUrl) && String(url) === String(feed.directUrl);
      const parseConfiguration = direct ? { ...feed, sourceAliases: [], sourceDomains: [] } : feed;
      const items = parseFeed(xml, parseConfiguration, effectiveCutoff, Number(feed.limit) || 15);
      if (!items.length) {
        errors.push(`Sem conteúdo válido nas últimas ${windowHours} horas`);
        continue;
      }
      return {
        items: items.map((item) => ({ ...item, collectionRoute: direct ? "direct" : "fallback" })),
        status: {
          id: feed.id,
          name: feed.name,
          region: feed.region || "Brasil",
          ok: true,
          count: items.length,
          error: null,
          warning: errors.length ? [...new Set(errors)].slice(0, 2).join(" | ") : null,
          fallback: !direct,
          cached: false,
          route: direct ? "direct" : "fallback",
          attempts: index + 1,
          windowHours,
        },
      };
    } catch (error) {
      errors.push(compactError(error));
    }
  }
  if (successfulResponses > 0 && feed.emptyIsHealthy) {
    return {
      items: [],
      status: {
        id: feed.id,
        name: feed.name,
        region: feed.region || "Brasil",
        ok: true,
        count: 0,
        error: null,
        warning: [...new Set(errors)].filter((message) => !message.startsWith("Sem conteúdo válido")).slice(0, 2).join(" | ") || null,
        fallback: false,
        cached: false,
        route: "no-new",
        attempts: feed.urls.length,
        windowHours,
      },
    };
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
      warning: null,
      fallback: false,
      cached: false,
      route: "failed",
      attempts: feed.urls.length,
      windowHours,
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

function cachedItemsForFeed(previousRound, feed, cutoff) {
  const items = Array.isArray(previousRound?.items) ? previousRound.items : [];
  const cutoffTime = cutoff.getTime();
  return uniqueItems(items
    .filter((item) => item?.kind === "portal")
    .filter((item) => item.collectorName === feed.name || item.sourceName === feed.name)
    .filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoffTime;
    })
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, Number(feed.limit) || 15)
    .map((item) => ({ ...item, collectionRoute: "cache", collectorName: feed.name, sourceName: feed.name })), Number(feed.limit) || 15);
}

export async function collectRound({ fetcher = fetch, now = new Date(), feeds = FEEDS, monitoringTerms = [], previousRound = null } = {}) {
  const startedAt = Date.now();
  const collectedAt = new Date(now);
  const cutoff = new Date(collectedAt.getTime() - 24 * 60 * 60 * 1000);
  const requestBudget = { remaining: PORTAL_SUBREQUEST_LIMIT, seenUrls: new Set() };
  const portalFetcher = sharedResponseFetcher(fetcher);
  const [portalResults, dedicatedMonitoring] = await Promise.all([
    Promise.all(feeds.map((feed) => collectFeed(feed, cutoff, portalFetcher, requestBudget))),
    collectDedicatedMonitoring(monitoringTerms, cutoff, fetcher),
  ]);
  const resilientPortalResults = portalResults.map((result, index) => {
    if (result.status.ok) return result;
    const feed = feeds[index];
    const cachedItems = cachedItemsForFeed(previousRound, feed, cutoff);
    if (!cachedItems.length) return result;
    return {
      items: cachedItems,
      status: {
        ...result.status,
        ok: true,
        count: cachedItems.length,
        error: null,
        warning: result.status.error,
        fallback: true,
        cached: true,
        route: "cache",
      },
    };
  });
  const portalItems = uniqueItems(resilientPortalResults.flatMap((result) => result.items), 435);
  const portalStatuses = resilientPortalResults.map((result) => result.status);

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
