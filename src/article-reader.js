import { decodeEntities, plainText, stableHash } from "./parser.js";

export const ARTICLE_ANALYSIS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const ARTICLE_READER_LIMIT = 5;
const MAX_HTML_BYTES = 2_500_000;
const MAX_ARTICLE_CHARS = 8_000;
const MAX_PROMPT_CHARS = 30_000;
const MIN_ARTICLE_WORDS = 80;

const NOISE_PATTERN = /(ad-|ads|advert|anuncio|banner|breadcrumb|cookie|coment|comments|footer|header|menu|nav|newsletter|paywall|popup|promo|publicidade|recommend|related|share|sidebar|social|subscribe|widget)/i;
const NOISE_SENTENCE = /(assine|aceite os cookies|continuar lendo|conteúdo patrocinado|leia também|mais lidas|publicidade|receba nossa newsletter|siga-nos|todos os direitos reservados)/i;
const EXPECTED_SLIDES = [
  [1, "Título principal"],
  [2, "Contexto"],
  [3, "Informação principal"],
  [4, "Detalhamento"],
  [5, "Consequência"],
  [6, "Conclusão"],
  [7, "CTA"],
];

function compact(value, limit = 300) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function wordCount(value) {
  return plainText(value).split(/\s+/).filter(Boolean).length;
}

function safeJsonParse(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function decodeHtmlBuffer(bytes, contentType = "") {
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, "");
  const sample = new TextDecoder("windows-1252").decode(bytes.slice(0, 500));
  const declared = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(sample)?.[1]
    || /<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i.exec(sample)?.[1];
  const raw = String(headerCharset || declared || "utf-8").toLowerCase();
  const charset = ["iso-8859-1", "latin1", "windows-1252", "cp1252"].includes(raw) ? "windows-1252" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

function metaContent(html, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return compact(decodeEntities(match[1]), 500);
  }
  return "";
}

function jsonLdNodes(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdNodes(item, output));
    return output;
  }
  output.push(value);
  if (value["@graph"]) jsonLdNodes(value["@graph"], output);
  return output;
}

function extractJsonLdArticle(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const content = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    const parsed = safeJsonParse(decodeEntities(content));
    const nodes = jsonLdNodes(parsed);
    const article = nodes.find((node) => {
      const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
      return types.some((type) => /^(NewsArticle|Article|Reportage|AnalysisNewsArticle|BlogPosting)$/i.test(String(type || ""))) && plainText(node.articleBody);
    });
    if (!article) continue;
    const authorValue = Array.isArray(article.author) ? article.author : [article.author];
    const byline = authorValue.map((author) => plainText(author?.name || author)).filter(Boolean).join(", ");
    return {
      title: compact(article.headline || article.name, 240),
      description: compact(article.description, 500),
      byline: compact(byline, 180),
      publishedAt: plainText(article.datePublished || article.dateModified),
      content: cleanArticleText(article.articleBody),
      method: "json-ld",
    };
  }
  return null;
}

function removeNoiseBlocks(html) {
  let output = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|nav|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const blockPattern = /<(div|section|ul)\b([^>]*(?:id|class)=["'][^"']*(?:ad-|ads|advert|anuncio|banner|breadcrumb|cookie|comment|footer|header|menu|nav|newsletter|paywall|popup|promo|publicidade|recommend|related|share|sidebar|social|subscribe|widget)[^"']*["'][^>]*)>[\s\S]*?<\/\1\s*>/gi;
  for (let index = 0; index < 3; index += 1) output = output.replace(blockPattern, " ");
  return output;
}

function paragraphText(html) {
  const values = [];
  const seen = new Set();
  const expression = /<(p|h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = expression.exec(html)) && values.length < 140) {
    const text = plainText(match[2]).replace(/\s+/g, " ").trim();
    const normalized = text.toLocaleLowerCase("pt-BR");
    if (text.length < 35 || text.length > 1_500 || NOISE_SENTENCE.test(text) || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(text);
  }
  return cleanArticleText(values.join("\n\n"));
}

function cleanArticleText(value) {
  const lines = String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => plainText(line).trim())
    .filter((line) => line.length >= 25 && !NOISE_SENTENCE.test(line));
  const output = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(line);
    if (output.join("\n\n").length >= MAX_ARTICLE_CHARS) break;
  }
  return output.join("\n\n").slice(0, MAX_ARTICLE_CHARS).trim();
}

function candidateBlocks(html) {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main\s*>/gi,
    /<(?:div|section)\b[^>]*(?:id|class)=["'][^"']*(?:article-body|article-content|content-article|materia|news-body|post-content|story-body|texto)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section)\s*>/gi,
  ];
  for (const pattern of patterns) {
    const matches = html.match(pattern) || [];
    candidates.push(...matches.slice(0, 12));
  }
  return candidates;
}

export function extractArticleFromHtml(html, fallback = {}) {
  const raw = String(html || "").slice(0, MAX_HTML_BYTES);
  const structured = extractJsonLdArticle(raw);
  const title = structured?.title || metaContent(raw, "og:title") || metaContent(raw, "twitter:title") || compact(fallback.title, 240);
  const description = structured?.description || metaContent(raw, "description") || metaContent(raw, "og:description") || compact(fallback.description, 500);
  const byline = structured?.byline || metaContent(raw, "author");
  const publishedAt = structured?.publishedAt || metaContent(raw, "article:published_time") || fallback.publishedAt || null;

  if (structured?.content && wordCount(structured.content) >= MIN_ARTICLE_WORDS) {
    return { title, description, byline, publishedAt, content: structured.content, wordCount: wordCount(structured.content), method: structured.method };
  }

  const cleanedHtml = removeNoiseBlocks(raw);
  let best = "";
  let bestScore = 0;
  for (const candidate of candidateBlocks(cleanedHtml)) {
    const text = paragraphText(candidate);
    const count = wordCount(text);
    const score = count + (text.match(/\n\n/g)?.length || 0) * 8;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  if (wordCount(best) < MIN_ARTICLE_WORDS) best = paragraphText(cleanedHtml);
  if (wordCount(best) < MIN_ARTICLE_WORDS && description) best = cleanArticleText(`${description}\n\n${fallback.description || ""}`);
  return { title, description, byline, publishedAt, content: best, wordCount: wordCount(best), method: best ? "html" : "metadata" };
}

function isPrivateHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!value || value === "localhost" || value.endsWith(".local") || value.endsWith(".internal")) return true;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(value)) return true;
  const match = /^(172)\.(\d{1,3})\./.exec(value);
  if (match && Number(match[2]) >= 16 && Number(match[2]) <= 31) return true;
  if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

export function validateArticleUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL da matéria inválida"); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) throw new Error("URL da matéria não permitida");
  return url.toString();
}

async function fetchArticleHtml(url, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Tempo limite da matéria excedido"), 12_000);
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "RondaEditorial/2.0 (+leitura editorial; contato pelo domínio do Worker)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    validateArticleUrl(response.url || url);
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou uma página HTML");
    const length = Number(response.headers.get("Content-Length")) || 0;
    if (length > MAX_HTML_BYTES * 2) throw new Error("Página maior que o limite seguro");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return decodeHtmlBuffer(buffer.slice(0, MAX_HTML_BYTES), contentType);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readArticle(item, fetcher = fetch) {
  const url = validateArticleUrl(item?.url);
  try {
    const html = await fetchArticleHtml(url, fetcher);
    const extracted = extractArticleFromHtml(html, item);
    if (extracted.wordCount < MIN_ARTICLE_WORDS) throw new Error("Conteúdo principal insuficiente ou bloqueado pelo portal");
    return {
      ok: true,
      url,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: extracted.title || item?.title || "Notícia sem título",
      publishedAt: extracted.publishedAt || item?.publishedAt || null,
      byline: extracted.byline || null,
      wordCount: extracted.wordCount,
      extractionMethod: extracted.method,
      content: extracted.content,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: item?.title || "Notícia sem título",
      publishedAt: item?.publishedAt || null,
      byline: null,
      wordCount: 0,
      extractionMethod: null,
      content: "",
      error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  }
}

function distinctPortalItems(topic) {
  const items = Array.isArray(topic?.items) ? topic.items : [];
  const seenUrls = new Set();
  const seenSources = new Set();
  const ordered = [...items]
    .filter((item) => item?.kind !== "social" && /^https?:\/\//i.test(String(item?.url || "")))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const preferred = [];
  const remainder = [];
  for (const item of ordered) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    const source = item.collectorName || item.sourceName;
    if (source && !seenSources.has(source)) {
      seenSources.add(source);
      preferred.push(item);
    } else remainder.push(item);
  }
  return [...preferred, ...remainder].slice(0, ARTICLE_READER_LIMIT);
}

function sentences(value) {
  return plainText(value).split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/).map((item) => item.trim()).filter((item) => item.length >= 35);
}

function firstMatchingSentence(list, pattern, fallback) {
  return compact(list.find((item) => pattern.test(item)) || fallback || "Não informado nas matérias lidas.", 360);
}

function heuristicEntities(text) {
  const people = [];
  const companies = [];
  const places = [];
  const dates = [];
  const themes = [];
  const keywords = [];
  const add = (list, value, limit = 8) => {
    const clean = compact(value, 80);
    if (clean && !list.some((item) => item.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR")) && list.length < limit) list.push(clean);
  };
  for (const match of text.matchAll(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+){1,3})\b/gu)) add(people, match[1]);
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3})\s+(?:S\.A\.|Ltda\.|Inc\.|Corp\.|Company|Banco|Ministério|Secretaria|Prefeitura|Governo)\b/g)) add(companies, match[0]);
  for (const match of text.matchAll(/\b(?:em|no|na|nos|nas)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}-]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}-]+){0,2})\b/gu)) add(places, match[1]);
  for (const match of text.matchAll(/\b(?:\d{1,2}\s+de\s+[a-zç]+(?:\s+de\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4})\b/gi)) add(dates, match[0]);
  const normalized = plainText(text).toLocaleLowerCase("pt-BR");
  const themeCatalog = ["política", "economia", "tecnologia", "saúde", "esportes", "segurança", "justiça", "meio ambiente", "educação", "cultura", "internacional"];
  themeCatalog.forEach((theme) => { if (normalized.includes(theme)) add(themes, theme); });
  const frequency = new Map();
  for (const token of normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{5,}/g) || []) {
    if (/^(sobre|entre|ainda|tambem|foram|segundo|noticia|materia|quando|depois|antes|todos|todas|porque|porem|desde|apenas)$/.test(token)) continue;
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([token]) => add(keywords, token));
  return { people, companies, places, dates, themes, keywords };
}

function fallbackAnalysis(topic, articles, socialItems) {
  const combined = articles.map((article) => article.content).join("\n\n");
  const list = sentences(combined);
  const headline = compact(topic?.title || articles[0]?.title || "Assunto em acompanhamento", 110);
  const whatHappened = compact(list.slice(0, 2).join(" ") || topic?.items?.[0]?.description || headline, 420);
  const context = compact(list.slice(2, 4).join(" ") || whatHappened, 420);
  const details = compact(list.slice(4, 7).join(" ") || context, 420);
  const impact = firstMatchingSentence(list, /impact|consequ|efeito|mudan|risco|benef|preju|custo|afeta|pode/i, details);
  const repercussion = socialItems.length
    ? `O assunto também apareceu em ${socialItems.length} publicação${socialItems.length === 1 ? "" : "ões"} do Bluesky monitoradas pela ronda.`
    : firstMatchingSentence(list, /repercuss|reação|critic|apoio|debate|manifest|resposta/i, "As matérias lidas ainda não detalham uma repercussão consolidada.");
  const entities = heuristicEntities(`${headline}\n${combined}`);
  return {
    questions: {
      whatHappened,
      who: entities.people.length || entities.companies.length ? [...entities.people, ...entities.companies].slice(0, 8).join(", ") : "Não informado com segurança nas matérias lidas.",
      where: entities.places.join(", ") || "Não informado com segurança nas matérias lidas.",
      when: entities.dates.join(", ") || articles.map((item) => item.publishedAt).filter(Boolean).slice(0, 2).join("; ") || "Não informado.",
      impact,
      repercussion,
    },
    entities,
    slides: [
      { number: 1, role: "Título principal", title: headline, body: "O ponto central da notícia em linguagem direta." },
      { number: 2, role: "Contexto", title: "Entenda o cenário", body: context },
      { number: 3, role: "Informação principal", title: "O que aconteceu", body: whatHappened },
      { number: 4, role: "Detalhamento", title: "Os principais detalhes", body: details },
      { number: 5, role: "Consequência", title: "Qual é o impacto", body: impact },
      { number: 6, role: "Conclusão", title: "O que fica da notícia", body: compact(repercussion, 360) },
      { number: 7, role: "CTA", title: "Acompanhe os desdobramentos", body: "Consulte as fontes originais, salve este conteúdo e acompanhe as próximas atualizações." },
    ],
  };
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "object",
      properties: {
        whatHappened: { type: "string" },
        who: { type: "string" },
        where: { type: "string" },
        when: { type: "string" },
        impact: { type: "string" },
        repercussion: { type: "string" },
      },
      required: ["whatHappened", "who", "where", "when", "impact", "repercussion"],
    },
    entities: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" } },
        companies: { type: "array", items: { type: "string" } },
        places: { type: "array", items: { type: "string" } },
        dates: { type: "array", items: { type: "string" } },
        themes: { type: "array", items: { type: "string" } },
        keywords: { type: "array", items: { type: "string" } },
      },
      required: ["people", "companies", "places", "dates", "themes", "keywords"],
    },
    slides: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          role: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["number", "role", "title", "body"],
      },
    },
  },
  required: ["questions", "entities", "slides"],
};

function normalizeList(value, limit = 10) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = compact(item, 90);
    if (text && !output.includes(text) && output.length < limit) output.push(text);
  }
  return output;
}

function normalizeAnalysis(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const questions = {};
  for (const key of ["whatHappened", "who", "where", "when", "impact", "repercussion"]) {
    questions[key] = compact(source.questions?.[key] || fallback.questions[key], 440);
  }
  const entities = {};
  for (const key of ["people", "companies", "places", "dates", "themes", "keywords"]) {
    entities[key] = normalizeList(source.entities?.[key]?.length ? source.entities[key] : fallback.entities[key]);
  }
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const slides = EXPECTED_SLIDES.map(([number, role], index) => ({
    number,
    role,
    title: compact(rawSlides[index]?.title || fallback.slides[index]?.title || role, 120),
    body: compact(rawSlides[index]?.body || fallback.slides[index]?.body || "", 460),
  }));
  return { questions, entities, slides };
}

function promptFor(topic, articles, socialItems) {
  const sourceBlocks = articles.map((article, index) => [
    `MATÉRIA ${index + 1}`,
    `Portal: ${article.sourceName}`,
    `Título: ${article.title}`,
    `Data: ${article.publishedAt || "não informada"}`,
    `Texto extraído:\n${article.content.slice(0, 5_500)}`,
  ].join("\n")).join("\n\n---\n\n");
  const social = socialItems.slice(0, 8).map((item) => `- ${item.sourceName}: ${compact(item.title, 260)} (${Number(item.interactions) || 0} interações observadas)`).join("\n") || "Nenhuma publicação social relacionada foi captada.";
  return `ASSUNTO DA RONDA: ${compact(topic?.title, 180)}\nEDITORIA: ${topic?.editoria || "Notícias"}\n\n${sourceBlocks}\n\nSINAIS DE REPERCUSSÃO NO BLUESKY:\n${social}`.slice(0, MAX_PROMPT_CHARS);
}

async function runAiAnalysis(ai, model, topic, articles, socialItems) {
  const response = await ai.run(model, {
    messages: [
      {
        role: "system",
        content: "Você é um editor jornalístico brasileiro. Analise somente os textos fornecidos. Não invente fatos, nomes, datas, locais, impacto ou repercussão. Quando a informação não estiver comprovada, escreva 'Não informado nas matérias lidas'. Diferencie fato, contexto, consequência e repercussão. Produza um carrossel Instagram em português do Brasil com exatamente 7 slides: título principal, contexto, informação principal, detalhamento, consequência, conclusão e CTA. Use títulos claros e corpos curtos, factuais e independentes. Não use hashtags, emojis ou sensacionalismo.",
      },
      { role: "user", content: promptFor(topic, articles, socialItems) },
    ],
    response_format: { type: "json_schema", json_schema: ANALYSIS_SCHEMA },
    max_tokens: 2_400,
    temperature: 0.15,
    top_p: 0.85,
  });
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

function publicArticleRecord(article) {
  const { content: _content, ...record } = article;
  return record;
}

export function intelligentCarouselCacheKey(runId, topic) {
  const urls = (topic?.items || []).map((item) => String(item?.url || "").trim()).filter(Boolean).sort();
  return `smart-v1-${stableHash(`${runId || "latest"}|${topic?.id || "topic"}|${urls.join("|")}`)}`;
}

export async function buildIntelligentCarousel(topic, { ai, fetcher = fetch, model = ARTICLE_ANALYSIS_MODEL } = {}) {
  const requestedItems = distinctPortalItems(topic);
  if (!requestedItems.length) throw new Error("Este assunto não possui matérias de portal com URL válida para leitura.");
  const readResults = await Promise.all(requestedItems.map((item) => readArticle(item, fetcher)));
  const readable = readResults.filter((item) => item.ok && item.content);
  if (!readable.length) throw new Error("Nenhum portal liberou conteúdo suficiente para a leitura completa. Use os links de apuração manual.");
  const socialItems = (topic?.items || []).filter((item) => item?.kind === "social");
  const fallback = fallbackAnalysis(topic, readable, socialItems);
  let analysis = fallback;
  let analysisMode = "fallback";
  let aiError = null;
  if (ai?.run) {
    try {
      const generated = await runAiAnalysis(ai, model, topic, readable, socialItems);
      if (!generated) throw new Error("A IA não retornou JSON válido");
      analysis = normalizeAnalysis(generated, fallback);
      analysisMode = "ai";
    } catch (error) {
      aiError = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
      analysis = normalizeAnalysis(fallback, fallback);
    }
  } else analysis = normalizeAnalysis(fallback, fallback);

  const verificationLinks = (topic?.items || []).filter((item) => /^https?:\/\//i.test(String(item?.url || ""))).map((item) => ({
    title: compact(item.title || "Notícia sem título", 180),
    sourceName: item.sourceName || item.collectorName || "Fonte não informada",
    publishedAt: item.publishedAt || null,
    url: item.url,
  })).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
  const totalWords = readable.reduce((sum, item) => sum + item.wordCount, 0);
  return {
    language: "pt-BR",
    generatedAt: new Date().toISOString(),
    analysisMode,
    model: analysisMode === "ai" ? model : null,
    aiError,
    voiceTone: "Jornalístico, factual e explicativo",
    postModel: "Instagram · 7 slides",
    reading: {
      requested: requestedItems.length,
      successful: readable.length,
      failed: readResults.length - readable.length,
      totalWords,
      sources: readResults.map(publicArticleRecord),
    },
    questions: analysis.questions,
    entities: analysis.entities,
    slides: analysis.slides,
    verificationLinks,
    disclaimer: analysisMode === "ai"
      ? "Roteiro gerado após leitura automática do conteúdo principal das matérias. Revise nomes, números, datas e contexto nos links originais antes de publicar."
      : "A leitura das matérias foi concluída, mas a análise de IA não ficou disponível; o roteiro usa extração automática e exige revisão editorial completa.",
    cacheKey: intelligentCarouselCacheKey("generated", topic),
  };
}
