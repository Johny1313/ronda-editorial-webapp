// Ronda Editorial 2.4.3 — bundle autossuficiente para Cloudflare Workers
// Gerado em 2026-07-27T15:44:14.501Z
const __module_src_parser_js = (() => {

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
});

function decodeEntities(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

function plainText(value = "") {
  return decodeEntities(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagValue(block, names) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const expression = new RegExp(
      `<(?:[a-z0-9_-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${escaped}\\s*>`,
      "i",
    );
    const match = expression.exec(block);
    const text = match ? plainText(match[1]) : "";
    if (text) return text;
  }
  return "";
}

function attributeValue(attributes, name) {
  const match = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attributes);
  return match ? decodeEntities(match[2]).trim() : "";
}

function linkValue(block) {
  const candidates = [];
  const paired = /<(?:[a-z0-9_-]+:)?link\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?link\s*>/gi;
  const selfClosing = /<(?:[a-z0-9_-]+:)?link\b([^>]*?)\/?\s*>/gi;
  let match;

  while ((match = paired.exec(block))) {
    candidates.push({
      href: attributeValue(match[1], "href") || plainText(match[2]),
      rel: attributeValue(match[1], "rel"),
    });
  }
  while ((match = selfClosing.exec(block))) {
    const href = attributeValue(match[1], "href");
    if (href) candidates.push({ href, rel: attributeValue(match[1], "rel") });
  }

  const preferred = candidates.find((candidate) => !candidate.rel || candidate.rel === "alternate") ?? candidates[0];
  if (preferred?.href) return preferred.href;
  const guid = tagValue(block, ["guid", "id"]);
  return /^https?:\/\//i.test(guid) ? guid : "";
}

function sourceMetadata(block) {
  const match = /<(?:[a-z0-9_-]+:)?source\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?source\s*>/i.exec(block);
  if (!match) return { name: "", url: "" };
  return {
    name: plainText(match[2]),
    url: attributeValue(match[1], "url") || attributeValue(match[1], "href"),
  };
}

function normalizedHostname(value = "") {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stableHash(value = "") {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of String(value)) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + ((second << 6) >>> 0) + (second >>> 2);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function isoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizedSourceLabel(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceMatchesFeed(declaredSource, declaredSourceUrl, feed) {
  const aliases = Array.isArray(feed?.sourceAliases) ? feed.sourceAliases : [];
  const domains = Array.isArray(feed?.sourceDomains) ? feed.sourceDomains : [];
  if (!aliases.length && !domains.length) return true;

  const source = normalizedSourceLabel(declaredSource);
  const aliasMatch = source && aliases.some((alias) => {
    const normalizedAlias = normalizedSourceLabel(alias);
    return normalizedAlias && (source === normalizedAlias || source.includes(normalizedAlias) || normalizedAlias.includes(source));
  });
  if (aliasMatch) return true;

  const hostname = normalizedHostname(declaredSourceUrl);
  if (!hostname) return false;
  return domains.some((domain) => {
    const normalizedDomain = normalizedHostname(`https://${String(domain || "").replace(/^https?:\/\//i, "")}`);
    return normalizedDomain && (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`) || normalizedDomain.endsWith(`.${hostname}`));
  });
}

function parseFeed(xmlText, feed, cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000), limit = 40) {
  const xml = String(xmlText ?? "").slice(0, 3_000_000);
  const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Date.parse(cutoff);
  const now = Date.now() + 5 * 60 * 1000;
  const blocks = [];
  const itemExpression = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  const entryExpression = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi;
  let match;

  const scanLimit = Math.min(500, Math.max(limit * 2, Number(feed?.scanLimit) || 0));
  while ((match = itemExpression.exec(xml)) && blocks.length < scanLimit) blocks.push(match[1]);
  if (!blocks.length) {
    while ((match = entryExpression.exec(xml)) && blocks.length < scanLimit) blocks.push(match[1]);
  }

  const result = [];
  const seen = new Set();
  for (const block of blocks) {
    if (result.length >= limit) break;
    const title = tagValue(block, ["title"]);
    const declaredSourceMetadata = sourceMetadata(block);
    const declaredSource = declaredSourceMetadata.name;
    if (!sourceMatchesFeed(declaredSource, declaredSourceMetadata.url, feed)) continue;
    const feedDescription = tagValue(block, ["description", "summary"]);
    const feedContent = tagValue(block, ["encoded", "content"]);
    const collectedContent = feedContent || feedDescription;
    const storedContent = collectedContent.slice(0, 2_400);
    const publishedAt = isoDate(tagValue(block, ["pubDate", "published", "updated", "date"]));
    const url = linkValue(block);
    const timestamp = Date.parse(publishedAt);
    if (!title || !url || !publishedAt || !/^https?:\/\//i.test(url)) continue;
    if (!Number.isFinite(timestamp) || timestamp < cutoffTime || timestamp > now || seen.has(url)) continue;
    seen.add(url);

    const articleHostname = normalizedHostname(url);
    const publisherHomepageUrl = /^https?:\/\//i.test(String(declaredSourceMetadata.url || "")) ? declaredSourceMetadata.url : null;
    const publisherDomain = normalizedHostname(publisherHomepageUrl);
    const aggregatorUrl = articleHostname === "news.google.com" || articleHostname.endsWith(".google.com") || articleHostname.endsWith(".googleusercontent.com");
    const directPublisherUrl = Boolean(articleHostname && !aggregatorUrl && (!publisherDomain || articleHostname === publisherDomain || articleHostname.endsWith(`.${publisherDomain}`) || publisherDomain.endsWith(`.${articleHostname}`)));

    result.push({
      id: `rss-${feed.id}-${stableHash(url)}`,
      title,
      description: (feedDescription || feedContent).slice(0, 900),
      content: storedContent,
      contentSource: feedContent ? "feed-content" : feedDescription ? "feed-description" : "title-only",
      contentWordCount: storedContent.split(/\s+/).filter(Boolean).length,
      sourceName: feed.canonicalSource ? feed.name : declaredSource || feed.name,
      collectorName: feed.name,
      publisherHomepageUrl,
      publisherDomain: publisherDomain || null,
      articleDomain: articleHostname || null,
      directPublisherUrl,
      aggregatorUrl,
      region: feed.region || null,
      editorialHints: Array.isArray(feed.editorialHints) ? [...feed.editorialHints] : [],
      platform: "Portal",
      kind: "portal",
      publishedAt,
      url,
      views: null,
      comments: null,
      likes: null,
      interactions: null,
    });
  }
  return result;
}

return { "decodeEntities": decodeEntities, "plainText": plainText, "stableHash": stableHash, "parseFeed": parseFeed };
})();

const __module_src_clustering_js = (() => {
const { plainText, stableHash } = __module_src_parser_js;


const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "entre", "foi", "ha",
  "mais", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "ser", "sob", "sobre",
  "um", "uma", "vai", "apos", "ante", "ate", "contra", "durante", "noticia", "noticias", "hoje", "veja", "diz",
  "afirma", "novo", "nova", "brasil", "brasileiro", "brasileira",
]);

function normalizeText(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleTokens(title) {
  const output = [];
  const seen = new Set();
  for (const token of normalizeText(title).split(/\s+/)) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
    if (output.length >= 14) break;
  }
  return output;
}

function tokenSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) if (rightSet.has(token)) overlap += 1;
  if (!overlap) return 0;
  const union = leftSet.size + rightSet.size - overlap;
  const minimum = Math.min(leftSet.size, rightSet.size);
  const jaccard = overlap / union;
  const containment = overlap / minimum;
  const bonus = overlap >= 3 ? 0.2 : overlap >= 2 ? 0.08 : 0;
  return Math.min(1, jaccard * 0.55 + containment * 0.45 + bonus);
}

const EDITORIA_RULES = Object.freeze([
  ["Reality Shows", ["reality", "bbb", "big brother", "a fazenda", "paredao", "eliminado", "eliminada", "eliminacao", "prova do lider", "prova do anjo", "confinamento", "casa mais vigiada", "participante", "brother", "sister"]],
  ["Fofoca e Celebridades", ["famoso", "famosa", "famosos", "celebridade", "influenciador", "influenciadora", "influencer", "namoro", "casamento", "separacao", "termino", "affair", "traicao", "romance", "polêmica", "polemica", "bastidores", "vida pessoal", "ex marido", "ex mulher", "ex namorado", "ex namorada", "gravidez", "noivado"]],
  ["Curiosidades e Ciência Pop", ["curiosidade", "curioso", "curiosa", "descoberta", "cientista", "cientistas", "estudo", "pesquisa", "arqueologia", "arqueologico", "espaco", "universo", "planeta", "animal", "animais", "natureza", "fenomeno", "misterio", "historia", "prehistoria", "fossil", "dinossauro", "ciencia", "cientifico"]],
  ["Conteúdo Viral e Redes Sociais", ["viral", "redes sociais", "rede social", "tiktok", "instagram", "twitter", "x antigo twitter", "meme", "video", "internautas", "repercute", "repercutiu", "bombou", "trend", "desafio", "postagem", "publicacao", "compartilhado", "milhoes de visualizacoes"]],
  ["Segurança e Justiça", ["crime", "policia", "delegacia", "investigacao", "prisao", "preso", "presa", "assassinato", "assassinado", "assassinada", "homicidio", "feminicidio", "tiroteio", "baleado", "baleada", "sequestro", "violencia", "justica", "tribunal", "ministerio publico", "acidente fatal", "corpo encontrado"]],
  ["Esportes", ["futebol", "jogo", "partida", "campeonato", "brasileirao", "copa", "clube", "time", "jogador", "jogadora", "gol", "tecnico", "selecao", "formula 1", "f1", "basquete", "volei", "tenis", "olimpiada", "esporte"]],
  ["Política", ["presidente", "congresso", "senado", "camara", "deputado", "senador", "ministro", "governo", "eleicao", "eleitoral", "stf", "supremo", "partido", "prefeito", "governador", "planalto", "projeto de lei", "votacao", "politica"]],
  ["Economia", ["economia", "inflacao", "dolar", "bolsa", "juros", "banco", "mercado", "empresa", "emprego", "desemprego", "pib", "imposto", "investimento", "financeiro", "combustivel", "petroleo"]],
  ["Mundo", ["estados unidos", "eua", "trump", "guerra", "ucrania", "russia", "israel", "gaza", "china", "europa", "onu", "internacional", "exterior"]],
  ["Tecnologia", ["tecnologia", "inteligencia artificial", "ia", "internet", "aplicativo", "software", "celular", "smartphone", "google", "microsoft", "apple", "meta", "digital"]],
  ["Saúde", ["saude", "doenca", "vacina", "hospital", "medico", "medicina", "virus", "covid", "medicamento", "tratamento", "epidemia", "paciente"]],
  ["Entretenimento", ["filme", "serie", "novela", "musica", "cantor", "cantora", "atriz", "ator", "show", "festival", "televisao", "cinema", "streaming", "oscar", "programa de tv", "entretenimento"]],
]);

const DEATH_TERMS = Object.freeze([
  "morreu", "morre", "morto", "morta", "morte", "faleceu", "falecimento", "obito", "luto", "velorio", "funeral",
]);

const VIOLENT_DEATH_TERMS = Object.freeze([
  "assassinado", "assassinada", "assassinato", "homicidio", "feminicidio", "morto a tiros", "morta a tiros", "baleado", "baleada", "corpo encontrado", "encontrado morto", "encontrada morta", "acidente fatal",
]);

const FIGURATIVE_DEATH_PHRASES = Object.freeze([
  "morre de rir", "morreu de rir", "morre de amores", "morreu de amores", "morre de ciumes", "morreu de ciumes",
]);

const FICTION_CONTEXT_TERMS = Object.freeze([
  "personagem", "capitulo", "episodio", "novela", "serie", "filme", "ficcao", "trama", "roteiro",
]);

const REAL_PERSON_TERMS = Object.freeze([
  "ator", "atriz", "cantor", "cantora", "apresentador", "apresentadora", "jornalista", "influenciador", "influenciadora", "empresario", "empresaria", "jogador", "jogadora",
]);

function keywordMatch(text, keyword) {
  if (keyword.includes(" ")) return text.includes(keyword);
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function countKeywordMatches(text, keywords = []) {
  return keywords.reduce((total, keyword) => total + (keywordMatch(text, keyword) ? 1 : 0), 0);
}

function hasKeyword(text, keywords = []) {
  return keywords.some((keyword) => keywordMatch(text, keyword));
}

function editorialHintScore(items, editoria) {
  return items.reduce((score, item) => {
    const hints = Array.isArray(item?.editorialHints) ? item.editorialHints : [];
    const index = hints.indexOf(editoria);
    if (index < 0) return score;
    return score + (index === 0 ? 3 : 1);
  }, 0);
}

function isRealDeathStory(text) {
  if (!hasKeyword(text, DEATH_TERMS)) return false;
  if (FIGURATIVE_DEATH_PHRASES.some((phrase) => text.includes(phrase))) return false;
  const fictional = hasKeyword(text, FICTION_CONTEXT_TERMS);
  const realPerson = hasKeyword(text, REAL_PERSON_TERMS);
  return !fictional || realPerson;
}

function classifyEditoria(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const text = normalizeText(safeItems.map((item) => `${item?.title || ""} ${item?.description || ""}`).join(" "));

  if (hasKeyword(text, VIOLENT_DEATH_TERMS)) return "Segurança e Justiça";
  if (isRealDeathStory(text)) return "Luto e Obituário";

  let selected = "Notícias";
  let selectedScore = 0;
  for (const [editoria, keywords] of EDITORIA_RULES) {
    const score = countKeywordMatches(text, keywords) + editorialHintScore(safeItems, editoria);
    if (score > selectedScore) {
      selected = editoria;
      selectedScore = score;
    }
  }
  return selected;
}

function shorten(value, limit = 260) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function carouselTone(editoria, priority) {
  if (priority === "Pautar agora") return "Urgente, direto e factual";
  if (["Política", "Economia", "Mundo"].includes(editoria)) return "Informativo e analítico";
  if (["Saúde", "Tecnologia", "Curiosidades e Ciência Pop"].includes(editoria)) return "Explicativo e cauteloso";
  if (["Luto e Obituário", "Segurança e Justiça"].includes(editoria)) return "Sóbrio, factual e respeitoso";
  if (["Esportes", "Entretenimento", "Fofoca e Celebridades", "Reality Shows", "Conteúdo Viral e Redes Sociais"].includes(editoria)) return "Dinâmico e acessível";
  return "Informativo e objetivo";
}

function carouselModel(topic, normalizedText) {
  if (topic.priority === "Pautar agora") return "Instagram · Plantão em 7 slides";
  if (/\b(alerta|prazo|calendario|inscricao|como|servico|transito|previsao)\b/.test(normalizedText)) return "Instagram · Serviço em 7 slides";
  if ((topic.sourceNames?.length || topic.sourceCount || 0) >= 3 || (topic.items?.length || topic.itemCount || 0) >= 3) return "Instagram · Explicativo em 7 slides";
  if (["Luto e Obituário", "Segurança e Justiça"].includes(topic.editoria)) return "Instagram · Contexto factual em 7 slides";
  if (["Esportes", "Entretenimento", "Fofoca e Celebridades", "Reality Shows", "Conteúdo Viral e Redes Sociais"].includes(topic.editoria)) return "Instagram · Destaques em 7 slides";
  if (topic.editoria === "Curiosidades e Ciência Pop") return "Instagram · Curiosidade explicada em 7 slides";
  return "Instagram · 7 slides";
}

function buildVerificationLinks(items = []) {
  const links = [];
  const seen = new Set();
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({
      title: shorten(item?.title || "Notícia sem título", 180),
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      publishedAt: item?.publishedAt || null,
      url,
    });
  }
  return links;
}

function buildCarouselBrief(topic = {}) {
  const items = Array.isArray(topic.items) ? topic.items : [];
  const editoria = topic.editoria || classifyEditoria(items);
  const title = shorten(topic.title || items[0]?.title || "Assunto em acompanhamento", 120);
  const descriptions = [...new Set(items.map((item) => shorten(item?.description, 260)).filter((text) => text.length >= 25))];
  const relatedTitles = [...new Set(items.map((item) => shorten(item?.title, 120)).filter(Boolean))].slice(0, 3);
  const sources = [...new Set((topic.sourceNames || items.map((item) => item?.sourceName)).filter(Boolean))];
  const normalizedText = normalizeText(`${title} ${descriptions.join(" ")}`);
  const itemCount = Number(topic.itemCount) || items.length;
  const sourceCount = Number(topic.sourceCount) || sources.length;
  const displayedSourceCount = sourceCount || 1;
  const context = descriptions[0] || "A fonte não forneceu uma descrição completa. Use o título como ponto de partida e confirme os detalhes no link original.";
  const knownFacts = relatedTitles.length
    ? relatedTitles.map((item) => `• ${item}`).join("\n")
    : "• Consulte as fontes originais antes de fechar o texto.";
  const significance = sourceCount > 1
    ? `O assunto apareceu em ${sourceCount} fontes e reúne ${itemCount} conteúdos nesta ronda. A recorrência indica que merece acompanhamento editorial.`
    : `O assunto foi localizado em ${itemCount || 1} conteúdo nesta ronda. Busque uma segunda fonte independente antes de ampliar a pauta.`;
  const sourceLine = sources.length ? `Fontes monitoradas: ${sources.slice(0, 6).join(", ")}.` : "Fonte não informada pelo feed.";
  const verificationLinks = buildVerificationLinks(items);
  const callToAction = topic.priority === "Pautar agora"
    ? "Acompanhe as atualizações e confirme as informações nas fontes originais."
    : "Salve este carrossel e acompanhe os próximos desdobramentos.";

  return {
    language: "pt-BR",
    voiceTone: carouselTone(editoria, topic.priority),
    postModel: carouselModel({ ...topic, editoria }, normalizedText),
    disclaimer: "Prévia baseada nos títulos e descrições dos feeds. Use a Leitura Inteligente para abrir as matérias, extrair o conteúdo principal e gerar o roteiro final antes de publicar.",
    verificationLinks,
    slides: [
      { number: 1, role: "Título principal", title, body: `${editoria} · ${displayedSourceCount} ${displayedSourceCount === 1 ? "fonte monitorada" : "fontes monitoradas"}` },
      { number: 2, role: "Contexto", title: "Entenda o cenário", body: context },
      { number: 3, role: "Informação principal", title: "O que aconteceu", body: knownFacts },
      { number: 4, role: "Detalhamento", title: "O que precisa ser confirmado", body: `${sourceLine}
Abra os links originais para conferir nomes, números, datas e declarações.` },
      { number: 5, role: "Consequência", title: "Por que isso importa", body: significance },
      { number: 6, role: "Conclusão", title: "O que acompanhar agora", body: topic.priority === "Pautar agora" ? "O assunto exige atualização rápida e confirmação contínua nas fontes originais." : "Acompanhe novos fatos e procure uma segunda fonte independente antes de fechar a pauta." },
      { number: 7, role: "CTA", title: "Continue acompanhando", body: `${verificationLinks.length} ${verificationLinks.length === 1 ? "link de apuração disponível" : "links de apuração disponíveis"}.
${callToAction}` },
    ],
  };
}

function clusterItems(items, threshold = 0.36) {
  const clusters = [];
  const ordered = [...items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  for (const item of ordered) {
    const tokens = titleTokens(item.title);
    if (!tokens.length) continue;
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = tokenSimilarity(tokens, cluster.tokens);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best && bestScore >= threshold) {
      best.items.push(item);
      best.tokens = [...new Set([...best.tokens, ...tokens])].slice(0, 18);
    } else {
      clusters.push({ tokens, items: [item] });
    }
  }
  return clusters;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clusterToTopic(cluster, now = new Date()) {
  const items = [...cluster.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const representative = items.find((item) => item.kind === "portal") ?? items[0];
  const sourceNames = [...new Set(items.map((item) => item.sourceName).filter(Boolean))];
  const portalCount = items.filter((item) => item.kind === "portal").length;
  const socialCount = items.length - portalCount;
  const comments = items.reduce((sum, item) => sum + positiveNumber(item.comments), 0);
  const interactions = items.reduce((sum, item) => sum + positiveNumber(item.interactions), 0);
  const views = items.reduce((sum, item) => sum + positiveNumber(item.views), 0);
  const lastPublishedAt = items[0]?.publishedAt ?? now.toISOString();
  const ageHours = Math.max(0, (now.getTime() - Date.parse(lastPublishedAt)) / 3_600_000);
  const channelFactor = Math.min(1, sourceNames.length / 5);
  const volumeFactor = Math.min(1, items.length / 8);
  const socialFactor = Math.min(1, Math.log10(interactions + 1) / 4);
  const freshnessFactor = Math.exp(-ageHours / 6);
  const score = Math.max(1, Math.min(100, Math.round(channelFactor * 35 + volumeFactor * 30 + socialFactor * 20 + freshnessFactor * 15)));

  const tone = score >= 70 ? "urgent" : score >= 45 ? "watch" : "neutral";
  const priority = score >= 70 ? "Pautar agora" : score >= 45 ? "Acompanhar" : "Em observação";
  const momentum = sourceNames.length >= 3
    ? `${sourceNames.length} fontes publicaram sobre o assunto`
    : items.length >= 2
      ? `${items.length} conteúdos relacionados`
      : "Assunto recém-detectado";
  const recommendation = sourceNames.length >= 3
    ? "Confirmar os fatos nas fontes originais e preparar uma abordagem própria."
    : socialCount > 0
      ? "Checar se a repercussão social cresce antes de priorizar a pauta."
      : "Acompanhar novas publicações e buscar uma segunda fonte independente.";

  const topic = {
    id: `topic-${stableHash(cluster.tokens.slice(0, 6).join("-"))}`,
    title: representative?.title ?? "Assunto sem título",
    editoria: classifyEditoria(items),
    priority,
    tone,
    score,
    lastPublishedAt,
    sourceNames,
    sourceCount: sourceNames.length,
    itemCount: items.length,
    portalCount,
    socialCount,
    views: views || null,
    comments: comments || null,
    interactions: interactions || null,
    momentum,
    recommendation,
    items,
  };
  return { ...topic, carousel: buildCarouselBrief(topic) };
}

function buildTopics(items, now = new Date(), limit = 40) {
  return clusterItems(items)
    .map((cluster) => clusterToTopic(cluster, now))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt))
    .slice(0, limit);
}

return { "normalizeText": normalizeText, "titleTokens": titleTokens, "tokenSimilarity": tokenSimilarity, "classifyEditoria": classifyEditoria, "buildCarouselBrief": buildCarouselBrief, "clusterItems": clusterItems, "clusterToTopic": clusterToTopic, "buildTopics": buildTopics };
})();

const __module_src_article_reader_js = (() => {
const { decodeEntities, plainText, stableHash } = __module_src_parser_js;


const ARTICLE_ANALYSIS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ARTICLE_READER_LIMIT = 1;
const MAX_HTML_BYTES = 2_500_000;
const MAX_ARTICLE_CHARS = 12_000;
const MAX_PROMPT_CHARS = 30_000;
const MIN_ARTICLE_WORDS = 80;
const ARTICLE_FETCH_TIMEOUT_MS = 5_500;
const AMP_FETCH_TIMEOUT_MS = 3_000;
const ARTICLE_TOTAL_TIMEOUT_MS = 10_000;
const ARTICLE_PROGRESS_HEARTBEAT_MS = 1_100;
const READING_PROGRESS_START = 8;
const READING_PROGRESS_END = 60;
const AI_ANALYSIS_TIMEOUT_MS = 14_000;
const MAX_SLIDE_TITLE_CHARS = 68;
const MAX_SLIDE_SUBTITLE_CHARS = 190;
const CAROUSEL_PROMPT_VERSION = "facts-v3-direct-url-heartbeat";

const AGGREGATOR_HOSTS = new Set([
  "news.google.com",
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
]);

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

function normalizedTokens(value, minimumLength = 4) {
  return plainText(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= minimumLength && !/^(para|como|mais|pela|pelo|pelos|pelas|sobre|entre|apenas|ainda|esta|este|essa|esse|isso|noticia|materia)$/.test(token)) || [];
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizedTokens(left));
  const b = new Set(normalizedTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function tokenCoverage(query, text) {
  const expected = new Set(normalizedTokens(query));
  const available = new Set(normalizedTokens(text));
  if (!expected.size || !available.size) return 0;
  let intersection = 0;
  for (const token of expected) if (available.has(token)) intersection += 1;
  return intersection / expected.size;
}

function editorialClip(value, limit) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit + 1);
  const punctuation = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (punctuation >= limit * 0.58) return clipped.slice(0, punctuation + 1).trim();
  const boundary = clipped.lastIndexOf(" ");
  const safe = clipped.slice(0, boundary >= limit * 0.65 ? boundary : limit).replace(/[,:;–—-]+$/, "").trim();
  return safe ? `${safe}.` : "";
}

function canonicalHostname(value) {
  try { return new URL(String(value || "")).hostname.toLocaleLowerCase("pt-BR").replace(/^www\./, ""); } catch { return ""; }
}

function hostMatches(left, right) {
  const a = canonicalHostname(`https://${String(left || "").replace(/^https?:\/\//i, "")}`);
  const b = canonicalHostname(`https://${String(right || "").replace(/^https?:\/\//i, "")}`);
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));
}

function isAggregatorHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  if (AGGREGATOR_HOSTS.has(host)) return true;
  return host.endsWith(".google.com") || host.endsWith(".googleusercontent.com") || host.endsWith(".bing.com");
}

function publisherUrlSignals(item) {
  const urlHostname = canonicalHostname(item?.url);
  const declaredHostname = canonicalHostname(item?.publisherHomepageUrl || item?.declaredSourceUrl || item?.sourceUrl);
  const aggregator = isAggregatorHostname(urlHostname);
  const matchesDeclaredPublisher = declaredHostname ? hostMatches(urlHostname, declaredHostname) : !aggregator;
  const directPublisher = Boolean(urlHostname && !aggregator && matchesDeclaredPublisher);
  return { urlHostname, declaredHostname, aggregator, matchesDeclaredPublisher, directPublisher };
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

function extractArticleFromHtml(html, fallback = {}) {
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

function validateArticleUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL da matéria inválida"); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) throw new Error("URL da matéria não permitida");
  return url.toString();
}

function linkedPageUrl(html, baseUrl, relName) {
  const escaped = String(relName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["']`, "i"),
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${escaped}[^"']*["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(String(html || ""))?.[1];
    if (!value) continue;
    try { return validateArticleUrl(new URL(decodeEntities(value), baseUrl).toString()); } catch {}
  }
  return null;
}

async function fetchArticleHtml(url, fetcher, timeoutMs = ARTICLE_FETCH_TIMEOUT_MS, parentSignal = null) {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason || "Leitura da matéria cancelada");
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort("Tempo limite da matéria excedido");
  }, Math.max(250, Number(timeoutMs) || ARTICLE_FETCH_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.6",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; RondaEditorial/2.4.3; +leitura-editorial)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = validateArticleUrl(response.url || url);
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error("A URL não retornou uma página HTML");
    const length = Number(response.headers.get("Content-Length")) || 0;
    if (length > MAX_HTML_BYTES * 2) throw new Error("Página maior que o limite seguro");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { html: decodeHtmlBuffer(buffer.slice(0, MAX_HTML_BYTES), contentType), finalUrl };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener?.("abort", abortFromParent);
  }
}

async function readArticle(item, fetcher = fetch, { timeoutMs = ARTICLE_TOTAL_TIMEOUT_MS } = {}) {
  let url = String(item?.url || "");
  const controller = new AbortController();
  const totalTimeoutMs = Math.max(1_000, Number(timeoutMs) || ARTICLE_TOTAL_TIMEOUT_MS);
  const deadline = Date.now() + totalTimeoutMs;
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort("Tempo total da leitura excedido");
  }, totalTimeoutMs);
  const remaining = (limit) => Math.max(250, Math.min(limit, deadline - Date.now()));
  try {
    url = validateArticleUrl(url);
    const first = await fetchArticleHtml(url, fetcher, remaining(ARTICLE_FETCH_TIMEOUT_MS), controller.signal);
    let extracted = extractArticleFromHtml(first.html, item);
    let extractionUrl = first.finalUrl;
    if (extracted.wordCount < MIN_ARTICLE_WORDS && deadline - Date.now() > 900) {
      const ampUrl = linkedPageUrl(first.html, first.finalUrl, "amphtml");
      if (ampUrl && ampUrl !== first.finalUrl) {
        try {
          const amp = await fetchArticleHtml(ampUrl, fetcher, remaining(AMP_FETCH_TIMEOUT_MS), controller.signal);
          const ampExtracted = extractArticleFromHtml(amp.html, item);
          if (ampExtracted.wordCount > extracted.wordCount) {
            extracted = { ...ampExtracted, method: `amp-${ampExtracted.method}` };
            extractionUrl = amp.finalUrl;
          }
        } catch {}
      }
    }
    if (extracted.wordCount < MIN_ARTICLE_WORDS) throw new Error("Conteúdo principal insuficiente ou bloqueado pelo portal");
    return {
      ok: true,
      url,
      extractionUrl,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: extracted.title || item?.title || "Notícia sem título",
      publishedAt: extracted.publishedAt || item?.publishedAt || null,
      byline: extracted.byline || null,
      wordCount: extracted.wordCount,
      contentLevel: "article",
      readMode: "full-article",
      extractionMethod: extracted.method,
      content: extracted.content,
      error: null,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || /tempo limite|tempo total/i.test(String(error?.message || error));
    return {
      ok: false,
      url,
      extractionUrl: null,
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      title: item?.title || "Notícia sem título",
      publishedAt: item?.publishedAt || null,
      byline: null,
      wordCount: 0,
      contentLevel: null,
      readMode: timedOut ? "timeout" : "failed",
      extractionMethod: null,
      content: "",
      error: timedOut ? "Tempo limite da leitura direta; usado o conteúdo disponível no feed" : error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceStatFor(sourceStats, hostname) {
  if (!hostname || !sourceStats) return null;
  if (sourceStats instanceof Map) return sourceStats.get(hostname) || null;
  return sourceStats[hostname] || null;
}

function singlePortalItem(topic, sourceStats = null) {
  const items = Array.isArray(topic?.items) ? topic.items : [];
  const seen = new Set();
  const candidates = [];
  for (const item of items) {
    if (item?.kind === "social" || !plainText(item?.title)) continue;
    const identity = String(item?.url || item?.id || `${item?.sourceName}|${item?.title}`);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const collected = collectedContent(item);
    const levelScore = collected.level === "content" ? 70 : collected.level === "summary" ? 38 : 6;
    const hasUrl = /^https?:\/\//i.test(String(item?.url || ""));
    const publishedAt = Date.parse(item?.publishedAt || 0);
    const ageHours = Number.isFinite(publishedAt) ? Math.max(0, (Date.now() - publishedAt) / 3_600_000) : 48;
    const freshnessScore = Math.max(0, 20 - Math.min(20, ageHours * 1.25));
    const relevanceScore = Math.round(tokenCoverage(topic?.title || "", `${item?.title || ""} ${item?.description || ""}`) * 25);
    const hostname = canonicalHostname(item?.url);
    const urlSignals = publisherUrlSignals(item);
    const stats = sourceStatFor(sourceStats, hostname);
    const attempts = Number(stats?.attempts) || 0;
    const successes = Number(stats?.successes) || 0;
    const historicalRate = attempts ? successes / attempts : 0.5;
    const reliabilityScore = attempts >= 3 ? Math.round(historicalRate * 35) : 17;
    const contentScore = Math.min(42, collected.wordCount / 4);
    const directPublisherScore = urlSignals.directPublisher ? 40 : urlSignals.aggregator ? 0 : 12;
    const score = levelScore + contentScore + freshnessScore + relevanceScore + reliabilityScore + directPublisherScore + (hasUrl ? 25 : 0);
    candidates.push({
      item,
      hasUrl,
      directPublisher: urlSignals.directPublisher,
      score,
      hostname,
      reasons: {
        contentLevel: collected.level,
        contentWords: collected.wordCount,
        relevanceScore,
        freshnessScore: Math.round(freshnessScore),
        reliabilityScore,
        historicalAttempts: attempts,
        historicalSuccessRate: attempts ? Number(historicalRate.toFixed(2)) : null,
        directPublisherUrl: urlSignals.directPublisher,
        aggregatorUrl: urlSignals.aggregator,
        declaredPublisherDomain: urlSignals.declaredHostname || null,
      },
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
    });
  }
  const readableCandidates = candidates.filter((candidate) => candidate.hasUrl);
  const directPublisherCandidates = readableCandidates.filter((candidate) => candidate.directPublisher && candidate.reasons.contentLevel !== "title");
  const pool = directPublisherCandidates.length ? directPublisherCandidates : readableCandidates.length ? readableCandidates : candidates;
  pool.sort((left, right) => right.score - left.score || right.publishedAt - left.publishedAt);
  const selected = pool[0];
  return selected
    ? {
        item: selected.item,
        score: Math.round(selected.score),
        reasons: selected.reasons,
        hostname: selected.hostname,
        candidatesEvaluated: candidates.length,
      }
    : null;
}

function collectedContent(item) {
  const parts = [];
  const seen = new Set();
  const add = (value, method) => {
    const text = plainText(value).slice(0, MAX_ARTICLE_CHARS).trim();
    const key = text.toLocaleLowerCase("pt-BR");
    if (!text || seen.has(key)) return;
    seen.add(key);
    parts.push({ text, method });
  };
  add(item?.content, item?.contentSource || "feed-content");
  add(item?.contentEncoded, "feed-content");
  add(item?.description, "feed-description");
  add(item?.contentSnippet, "feed-summary");
  add(item?.summary, "feed-summary");
  if (!parts.length) add(item?.title, "title-only");
  const content = parts.map((part) => part.text).join("\n\n").slice(0, MAX_ARTICLE_CHARS).trim();
  const count = wordCount(content);
  const hasFullFeedContent = parts.some((part) => part.method === "feed-content") && count >= 60;
  const level = hasFullFeedContent ? "content" : count >= 18 ? "summary" : "title";
  return { content, wordCount: count, level, extractionMethod: parts[0]?.method || "title-only" };
}

function collectedRecord(item) {
  const collected = collectedContent(item);
  return {
    ok: Boolean(collected.content),
    url: /^https?:\/\//i.test(String(item?.url || "")) ? item.url : null,
    sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
    title: item?.title || "Notícia sem título",
    publishedAt: item?.publishedAt || null,
    byline: null,
    wordCount: collected.wordCount,
    contentLevel: collected.level,
    extractionMethod: collected.extractionMethod,
    content: collected.content,
    error: null,
    selectedArticleId: item?.id || null,
    originalUrl: /^https?:\/\//i.test(String(item?.url || "")) ? item.url : null,
    fallbackScope: "same-article",
  };
}


function articleReadCacheKey(item) {
  return stableHash([
    String(item?.url || ""),
    String(item?.title || ""),
    String(item?.publishedAt || ""),
    String(item?.content || item?.description || "").slice(0, 1_200),
  ].join("|"));
}

async function articleRecordWithFallback(item, fetcher, { timeoutMs = ARTICLE_TOTAL_TIMEOUT_MS, readCache = null } = {}) {
  const fallback = { ...collectedRecord(item), readMode: "feed-fallback", liveReadError: null, liveAttempted: false, cacheHit: false };
  if (!/^https?:\/\//i.test(String(item?.url || ""))) return fallback;
  const cacheKey = articleReadCacheKey(item);
  if (readCache?.get) {
    try {
      const cached = await readCache.get(cacheKey);
      if (cached?.content && wordCount(cached.content) >= MIN_ARTICLE_WORDS) {
        return {
          ...cached,
          ok: true,
          readMode: "full-article-cache",
          contentLevel: "article",
          wordCount: wordCount(cached.content),
          cacheHit: true,
          liveAttempted: false,
          liveReadError: null,
          error: null,
          selectedArticleId: item?.id || cached.selectedArticleId || null,
          originalUrl: item?.url || cached.originalUrl || cached.url || null,
          fallbackScope: "same-article",
        };
      }
    } catch {}
  }
  const live = await readArticle(item, fetcher, { timeoutMs });
  if (live.ok && live.content) {
    const record = {
      ...live,
      selectedArticleId: item?.id || null,
      originalUrl: item?.url || live.url || null,
      fallbackScope: "same-article",
      fallbackWordCount: fallback.wordCount,
      liveReadError: null,
      liveAttempted: true,
      cacheHit: false,
    };
    if (readCache?.set) {
      try { await readCache.set(cacheKey, record); } catch {}
    }
    return record;
  }
  return {
    ...fallback,
    readMode: live.readMode === "timeout" ? "feed-timeout" : "feed-fallback",
    liveAttempted: true,
    liveReadError: live.error || "Matéria indisponível",
    error: live.error || null,
  };
}

async function reportProgress(callback, progress, stage, message) {
  if (typeof callback !== "function") return;
  try { await callback({ progress, stage, message }); } catch {}
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withProgressHeartbeat(promise, callback, { intervalMs = ARTICLE_PROGRESS_HEARTBEAT_MS } = {}) {
  if (typeof callback !== "function") return promise;
  const wrapped = Promise.resolve(promise).then(
    (value) => ({ done: true, value }),
    (error) => ({ done: true, failed: true, error }),
  );
  const steps = [26, 34, 42, 50, 56];
  for (const progress of steps) {
    const state = await Promise.race([
      wrapped,
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), Math.max(5, Number(intervalMs) || ARTICLE_PROGRESS_HEARTBEAT_MS))),
    ]);
    if (state.done) {
      if (state.failed) throw state.error;
      return state.value;
    }
    await reportProgress(callback, progress, "reading", "A matéria continua em leitura; mantendo a tarefa ativa.");
  }
  const state = await wrapped;
  if (state.failed) throw state.error;
  return state.value;
}

function readingQuality(records) {
  const totalWords = records.reduce((sum, item) => sum + item.wordCount, 0);
  const articleSources = records.filter((item) => item.contentLevel === "article").length;
  const contentSources = records.filter((item) => item.contentLevel === "content").length;
  const summarySources = records.filter((item) => item.contentLevel === "summary").length;
  const titleOnlySources = records.filter((item) => item.contentLevel === "title").length;
  const combined = records.map((item) => item.content || "").join("\n\n");
  const tokens = normalizedTokens(combined, 3);
  const uniqueTokenRatio = tokens.length ? new Set(tokens).size / tokens.length : 0;
  const paragraphCount = combined.split(/\n{2,}/).map((item) => plainText(item)).filter((item) => wordCount(item) >= 12).length;
  const titleMatch = records.length
    ? Math.max(...records.map((item) => tokenCoverage(item.title || "", item.content || "")))
    : 0;
  let code = "insufficient";
  let label = "Conteúdo insuficiente";
  if (
    ((articleSources >= 1 && totalWords >= 160) || (contentSources >= 1 && totalWords >= 260))
    && uniqueTokenRatio >= 0.32
    && titleMatch >= 0.12
  ) {
    code = "broad";
    label = articleSources ? "Leitura ampla e consistente" : "Conteúdo amplo do feed";
  } else if (
    totalWords >= 85
    && titleOnlySources === 0
    && uniqueTokenRatio >= 0.25
  ) {
    code = "partial";
    label = articleSources ? "Leitura parcial da matéria" : "Conteúdo parcial";
  } else if (totalWords >= 18 && titleOnlySources === 0) {
    code = "limited";
    label = "Conteúdo limitado";
  }
  const generationAllowed = code !== "insufficient";
  const copyAllowed = code === "broad";
  return {
    code,
    label,
    totalWords,
    articleSources,
    contentSources,
    summarySources,
    titleOnlySources,
    paragraphCount,
    uniqueTokenRatio: Number(uniqueTokenRatio.toFixed(2)),
    titleMatch: Number(titleMatch.toFixed(2)),
    generationAllowed,
    copyAllowed,
  };
}

function sentences(value) {
  return plainText(value).split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/).map((item) => item.trim()).filter((item) => item.length >= 25);
}

function firstMatchingSentence(list, pattern, fallback) {
  return compact(list.find((item) => pattern.test(item)) || fallback || "Não informado no conteúdo coletado pela ronda.", 360);
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
    if (/^(sobre|entre|ainda|tambem|foram|segundo|noticia|materia|quando|depois|antes|todos|todas|porque|porem|desde|apenas|conteudo|ronda)$/.test(token)) continue;
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([token]) => add(keywords, token));
  return { people, companies, places, dates, themes, keywords };
}

function fallbackFactsFromArticle(article, limit = 8) {
  const list = sentences(`${article?.title || ""}. ${article?.content || ""}`);
  const output = [];
  const seen = new Set();
  for (const sentence of list) {
    const evidence = editorialClip(sentence, 240);
    const key = plainText(evidence).toLocaleLowerCase("pt-BR");
    if (!evidence || seen.has(key)) continue;
    seen.add(key);
    output.push({
      id: `fact-${output.length + 1}`,
      claim: editorialClip(sentence, 220),
      evidence,
      confidence: article?.contentLevel === "article" || article?.contentLevel === "content" ? "high" : "medium",
    });
    if (output.length >= limit) break;
  }
  if (!output.length && plainText(article?.title)) {
    output.push({
      id: "fact-1",
      claim: editorialClip(article.title, 180),
      evidence: editorialClip(article.title, 180),
      confidence: "low",
    });
  }
  return output;
}

function fallbackAnalysis(topic, articles, socialItems) {
  const combined = articles.map((article) => `${article.title}. ${article.content}`).join("\n\n");
  const list = sentences(combined);
  const headline = compact(articles[0]?.title || topic?.title || "Assunto em acompanhamento", 110);
  const whatHappened = compact(list.slice(0, 2).join(" ") || articles[0]?.content || headline, 420);
  const context = compact(list.slice(2, 4).join(" ") || articles[1]?.content || whatHappened, 420);
  const details = compact(list.slice(4, 7).join(" ") || articles.slice(1, 3).map((item) => item.content).join(" ") || context, 420);
  const impact = firstMatchingSentence(list, /impact|consequ|efeito|mudan|risco|benef|preju|custo|afeta|pode/i, details);
  const repercussion = socialItems.length
    ? `O assunto também apareceu em ${socialItems.length} publicação${socialItems.length === 1 ? "" : "ões"} do Bluesky monitoradas pela ronda.`
    : firstMatchingSentence(list, /repercuss|reação|critic|apoio|debate|manifest|resposta/i, "O conteúdo coletado ainda não detalha uma repercussão consolidada.");
  const entities = heuristicEntities(`${headline}\n${combined}`);
  const facts = fallbackFactsFromArticle(articles[0]);
  const slides = [
    { number: 1, role: "Título principal", title: headline, subtitle: compact(whatHappened, 260) },
    { number: 2, role: "Contexto", title: "Entenda o cenário", subtitle: context },
    { number: 3, role: "Informação principal", title: "O que aconteceu", subtitle: whatHappened },
    { number: 4, role: "Detalhamento", title: "Os principais detalhes", subtitle: details },
    { number: 5, role: "Consequência", title: "Qual é o impacto", subtitle: impact },
    { number: 6, role: "Conclusão", title: "O que fica da notícia", subtitle: compact(repercussion, 360) },
    { number: 7, role: "CTA", title: "Acompanhe os desdobramentos", subtitle: "Consulte a matéria original e acompanhe as próximas atualizações." },
  ].map((slide, index) => ({
    ...slide,
    body: slide.subtitle,
    evidenceIds: facts[index === 6 ? Math.max(0, facts.length - 1) : Math.min(index, Math.max(0, facts.length - 1))]?.id
      ? [facts[index === 6 ? Math.max(0, facts.length - 1) : Math.min(index, Math.max(0, facts.length - 1))].id]
      : [],
  }));
  return {
    questions: {
      whatHappened,
      who: entities.people.length || entities.companies.length ? [...entities.people, ...entities.companies].slice(0, 8).join(", ") : "Não informado com segurança no conteúdo coletado.",
      where: entities.places.join(", ") || "Não informado com segurança no conteúdo coletado.",
      when: entities.dates.join(", ") || articles.map((item) => item.publishedAt).filter(Boolean).slice(0, 2).join("; ") || "Não informado.",
      impact,
      repercussion,
    },
    entities,
    facts,
    slides,
  };
}

const FACT_ANALYSIS_SCHEMA = {
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
    facts: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["claim", "evidence", "confidence"],
      },
    },
  },
  required: ["questions", "entities", "facts"],
};

const CAROUSEL_SCHEMA = {
  type: "object",
  properties: {
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
          subtitle: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["number", "role", "title", "subtitle", "evidenceIds"],
      },
    },
  },
  required: ["slides"],
};

function normalizeList(value, limit = 10) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = compact(item, 90);
    if (text && !output.includes(text) && output.length < limit) output.push(text);
  }
  return output;
}

function normalizedEvidenceText(value) {
  return plainText(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numericTokens(value) {
  return normalizedEvidenceText(value).match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

function unsupportedNumbers(value, articleText) {
  const allowed = new Set(numericTokens(articleText));
  return numericTokens(value).filter((token) => !allowed.has(token));
}

function factHasEvidence(fact, article) {
  const content = normalizedEvidenceText(`${article?.title || ""} ${article?.content || ""}`);
  const evidence = normalizedEvidenceText(fact?.evidence || "");
  if (!evidence || evidence.length < 16) return false;
  if (content.includes(evidence)) return true;
  return tokenSimilarity(evidence, content) >= 0.72 && unsupportedNumbers(evidence, content).length === 0;
}

function normalizeFacts(value, fallbackFacts, article) {
  const output = [];
  const sourceText = `${article?.title || ""} ${article?.content || ""}`;
  for (const raw of Array.isArray(value) ? value : []) {
    const fact = {
      claim: editorialClip(raw?.claim, 220),
      evidence: editorialClip(raw?.evidence, 240),
      confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "medium",
    };
    if (!fact.claim || !factHasEvidence(fact, article) || unsupportedNumbers(fact.claim, sourceText).length) continue;
    output.push({ ...fact, id: `fact-${output.length + 1}` });
    if (output.length >= 10) break;
  }
  return output.length ? output : fallbackFacts.map((fact, index) => ({ ...fact, id: `fact-${index + 1}` }));
}

function normalizeFactAnalysis(value, fallback, article) {
  const source = value && typeof value === "object" ? value : {};
  const questions = {};
  const sourceText = `${article?.title || ""} ${article?.content || ""}`;
  for (const key of ["whatHappened", "who", "where", "when", "impact", "repercussion"]) {
    const generated = editorialClip(source.questions?.[key], 360);
    questions[key] = generated && !unsupportedNumbers(generated, sourceText).length
      ? generated
      : editorialClip(fallback.questions[key], 360);
  }
  const entities = {};
  const articleEvidence = normalizedEvidenceText(`${article?.title || ""} ${article?.content || ""}`);
  for (const key of ["people", "companies", "places", "dates", "themes", "keywords"]) {
    const generated = normalizeList(source.entities?.[key]);
    const supported = generated.filter((item) => {
      const normalized = normalizedEvidenceText(item);
      if (!normalized) return false;
      if (articleEvidence.includes(normalized)) return true;
      return normalizedTokens(normalized).some((token) => articleEvidence.includes(token));
    });
    entities[key] = supported.length ? supported : normalizeList(fallback.entities[key]);
  }
  const facts = normalizeFacts(source.facts, fallback.facts, article);
  return { questions, entities, facts };
}

function normalizeSlides(value, fallback, facts) {
  const source = value && typeof value === "object" ? value : {};
  const rawSlides = Array.isArray(source.slides) ? source.slides : [];
  const slides = EXPECTED_SLIDES.map(([number, role], index) => {
    const subtitle = editorialClip(
      rawSlides[index]?.subtitle || rawSlides[index]?.body || fallback.slides[index]?.subtitle || fallback.slides[index]?.body || "",
      MAX_SLIDE_SUBTITLE_CHARS,
    );
    const requestedEvidence = normalizeList(rawSlides[index]?.evidenceIds, 4);
    const evidenceIds = requestedEvidence.filter((id) => facts.some((fact) => fact.id === id));
    const fallbackEvidence = fallback.slides[index]?.evidenceIds?.filter((id) => facts.some((fact) => fact.id === id)) || [];
    return {
      number,
      role,
      title: editorialClip(rawSlides[index]?.title || fallback.slides[index]?.title || role, MAX_SLIDE_TITLE_CHARS),
      subtitle,
      body: subtitle,
      evidenceIds: evidenceIds.length ? evidenceIds : fallbackEvidence.length ? fallbackEvidence : facts[0]?.id ? [facts[0].id] : [],
    };
  });
  return slides;
}

function validateSlides(slides, fallbackSlides, facts, article) {
  const issues = [];
  const corrected = slides.map((slide) => ({ ...slide, evidenceIds: [...(slide.evidenceIds || [])] }));
  const sourceText = `${article?.title || ""} ${article?.content || ""}`;
  for (let index = 0; index < corrected.length; index += 1) {
    const slide = corrected[index];
    if (!slide.title || !slide.subtitle) {
      issues.push({ code: "empty-slide", slide: index + 1 });
      corrected[index] = { ...fallbackSlides[index], evidenceIds: fallbackSlides[index]?.evidenceIds || [] };
      continue;
    }
    const unsupported = unsupportedNumbers(`${slide.title} ${slide.subtitle}`, sourceText);
    if (unsupported.length) {
      issues.push({ code: "unsupported-number", slide: index + 1, values: unsupported });
      corrected[index] = { ...fallbackSlides[index], evidenceIds: fallbackSlides[index]?.evidenceIds || [] };
    }
  }
  for (let left = 0; left < corrected.length; left += 1) {
    for (let right = left + 1; right < corrected.length; right += 1) {
      if (tokenSimilarity(corrected[left].subtitle, corrected[right].subtitle) < 0.76) continue;
      issues.push({ code: "repeated-slide", slide: right + 1, similarTo: left + 1 });
      corrected[right] = { ...fallbackSlides[right], evidenceIds: fallbackSlides[right]?.evidenceIds || [] };
    }
  }
  const finalProblems = corrected.flatMap((slide, index) => {
    const problems = [];
    if (!slide.title || !slide.subtitle) problems.push({ code: "empty-slide", slide: index + 1 });
    if (unsupportedNumbers(`${slide.title} ${slide.subtitle}`, sourceText).length) problems.push({ code: "unsupported-number", slide: index + 1 });
    if ((slide.evidenceIds || []).some((id) => !facts.some((fact) => fact.id === id))) problems.push({ code: "invalid-evidence", slide: index + 1 });
    return problems;
  });
  const evidenceCoverage = corrected.length
    ? corrected.filter((slide) => slide.evidenceIds?.length).length / corrected.length
    : 0;
  return {
    slides: corrected.map((slide) => ({ ...slide, body: slide.subtitle })),
    report: {
      passed: finalProblems.length === 0,
      issues,
      finalProblems,
      correctedSlides: [...new Set(issues.map((issue) => issue.slide).filter(Boolean))],
      factCount: facts.length,
      evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
      limits: { titleChars: MAX_SLIDE_TITLE_CHARS, subtitleChars: MAX_SLIDE_SUBTITLE_CHARS },
    },
  };
}

function promptForFacts(topic, article, quality) {
  const contentType = article.contentLevel === "article"
    ? "texto principal extraído da matéria original"
    : article.contentLevel === "content"
      ? "texto fornecido pelo feed da mesma matéria"
      : article.contentLevel === "summary"
        ? "resumo fornecido pelo feed da mesma matéria"
        : "somente o título da mesma matéria";
  return [
    `ASSUNTO DA SUGESTÃO: ${compact(topic?.title || article.title, 180)}`,
    `EDITORIA: ${topic?.editoria || "Notícias"}`,
    `QUALIDADE DO CONTEÚDO: ${quality.label}`,
    "REGRA DE FONTE: use somente a matéria abaixo. Outras fontes do assunto não foram lidas e não podem ser usadas, comparadas ou inferidas.",
    `PORTAL SELECIONADO: ${article.sourceName}`,
    `TÍTULO DA MATÉRIA: ${article.title}`,
    `DATA: ${article.publishedAt || "não informada"}`,
    `TIPO DE CONTEÚDO: ${contentType}`,
    article.liveReadError ? `FALHA DA LEITURA DIRETA: ${article.liveReadError}` : null,
    `TEXTO ÚNICO DISPONÍVEL PARA ANÁLISE:
${article.content.slice(0, MAX_ARTICLE_CHARS)}`,
    "Extraia somente fatos sustentados por trechos do texto. Para cada fato, copie uma evidência curta que exista na matéria. Não redija slides nesta etapa.",
  ].filter(Boolean).join("\n\n").slice(0, MAX_PROMPT_CHARS);
}

async function runAiFactAnalysis(ai, model, topic, article, quality) {
  const response = await withTimeout(ai.run(model, {
    messages: [
      {
        role: "system",
        content: "Você é um editor de apuração jornalística brasileiro. Receberá exatamente UMA matéria. Use exclusivamente esse texto único. Não combine, compare, confirme nem complete informações com conhecimento externo, títulos da ronda ou sinais sociais. Extraia perguntas editoriais, entidades e um mapa de fatos. Cada fato precisa de uma evidência textual curta existente na matéria. Não invente nomes, números, datas, locais, impacto ou repercussão. Quando não houver comprovação, escreva 'Não informado no conteúdo disponível'. Retorne somente o JSON solicitado.",
      },
      { role: "user", content: promptForFacts(topic, article, quality) },
    ],
    response_format: { type: "json_schema", json_schema: FACT_ANALYSIS_SCHEMA },
    max_tokens: 1_800,
    temperature: 0.05,
    top_p: 0.75,
  }), AI_ANALYSIS_TIMEOUT_MS, "A extração dos fatos excedeu o tempo limite");
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

function carouselPrompt(topic, factAnalysis, quality) {
  return [
    `ASSUNTO: ${compact(topic?.title, 180)}`,
    `EDITORIA: ${topic?.editoria || "Notícias"}`,
    `QUALIDADE: ${quality.label}`,
    `MAPA DE FATOS VALIDADO:
${JSON.stringify(factAnalysis.facts)}`,
    `RESPOSTAS EDITORIAIS VALIDADAS:
${JSON.stringify(factAnalysis.questions)}`,
    "Escreva exatamente sete slides: 1 título principal; 2 contexto; 3 informação principal; 4 detalhamento; 5 consequência; 6 conclusão; 7 CTA.",
    `Limites obrigatórios: título com até ${MAX_SLIDE_TITLE_CHARS} caracteres e subtítulo com até ${MAX_SLIDE_SUBTITLE_CHARS} caracteres. Use no máximo duas frases por subtítulo.`,
    "Cada slide deve trazer uma ideia diferente e indicar em evidenceIds os fatos utilizados. Não crie nomes, números, datas ou consequências fora do mapa. O CTA não pode acrescentar fatos.",
    "Não use hashtags, emojis, sensacionalismo nem comentários fora do JSON. Depois do slide 7, encerre a geração.",
  ].join("\n\n").slice(0, MAX_PROMPT_CHARS);
}

async function runAiCarouselGeneration(ai, model, topic, factAnalysis, quality) {
  const response = await withTimeout(ai.run(model, {
    messages: [
      {
        role: "system",
        content: "Você é um redator de carrosséis jornalísticos em português do Brasil. Trabalhe somente com o mapa de fatos validado de UMA matéria. Produza exatamente sete slides concisos, factuais e não repetitivos. Cada slide deve conter apenas título, subtítulo e evidenceIds. Não use conhecimento externo. Retorne somente o JSON solicitado e encerre após o sétimo slide.",
      },
      { role: "user", content: carouselPrompt(topic, factAnalysis, quality) },
    ],
    response_format: { type: "json_schema", json_schema: CAROUSEL_SCHEMA },
    max_tokens: 1_600,
    temperature: 0.12,
    top_p: 0.82,
  }), AI_ANALYSIS_TIMEOUT_MS, "A redação do carrossel excedeu o tempo limite");
  return safeJsonParse(response?.response ?? response?.result ?? response);
}

function publicArticleRecord(article) {
  const { content: _content, ...record } = article;
  return record;
}

function intelligentCarouselCacheKey(runId, topic) {
  const selected = singlePortalItem(topic);
  const item = selected?.item;
  const sourceFingerprint = [item?.url, item?.title, item?.publishedAt, item?.content, item?.description].filter(Boolean).join("|");
  return `smart-v6-${stableHash(`${runId || "latest"}|${topic?.id || "topic"}|${CAROUSEL_PROMPT_VERSION}|${sourceFingerprint}`)}`;
}

async function buildIntelligentCarousel(topic, {
  ai,
  model = ARTICLE_ANALYSIS_MODEL,
  fetcher = fetch,
  liveReading = true,
  onProgress = null,
  articleTimeoutMs = ARTICLE_TOTAL_TIMEOUT_MS,
  progressHeartbeatMs = ARTICLE_PROGRESS_HEARTBEAT_MS,
  sourceStats = null,
  readCache = null,
} = {}) {
  const selection = singlePortalItem(topic, sourceStats);
  const selectedItem = selection?.item;
  if (!selectedItem) throw new Error("Este assunto não possui conteúdo de portal armazenado na ronda.");
  const selectedSourceName = selectedItem.sourceName || selectedItem.collectorName || "Fonte não informada";

  await reportProgress(onProgress, READING_PROGRESS_START, "reading", `Selecionando uma única matéria: ${compact(selectedSourceName, 70)}.`);
  await reportProgress(onProgress, 18, "reading", `Abrindo a matéria escolhida em ${compact(selectedSourceName, 70)}.`);
  let selectedRecord;
  if (liveReading) {
    const sameArticleFallback = {
      ...collectedRecord(selectedItem),
      readMode: "feed-timeout",
      liveReadError: "Tempo limite da leitura direta; usado o conteúdo disponível no feed da mesma matéria",
      error: "Tempo limite da leitura direta; usado o conteúdo disponível no feed da mesma matéria",
      liveAttempted: true,
      cacheHit: false,
      fallbackScope: "same-article",
    };
    try {
      selectedRecord = await withProgressHeartbeat(
        withTimeout(
          articleRecordWithFallback(selectedItem, fetcher, { timeoutMs: articleTimeoutMs, readCache }),
          Math.max(1_950, Number(articleTimeoutMs) || ARTICLE_TOTAL_TIMEOUT_MS) + 750,
          "Tempo limite da matéria selecionada excedido",
        ),
        onProgress,
        { intervalMs: progressHeartbeatMs },
      );
    } catch {
      selectedRecord = sameArticleFallback;
    }
  } else {
    selectedRecord = {
      ...collectedRecord(selectedItem),
      readMode: "feed-only",
      liveReadError: null,
      liveAttempted: false,
      cacheHit: false,
    };
  }
  selectedRecord.selection = {
    score: selection.score,
    hostname: selection.hostname,
    candidatesEvaluated: selection.candidatesEvaluated,
    reasons: selection.reasons,
    directPublisherUrl: Boolean(selection.reasons?.directPublisherUrl),
  };
  const collected = selectedRecord?.content ? [selectedRecord] : [];
  if (!collected.length) throw new Error("A matéria selecionada não possui conteúdo suficiente para gerar o roteiro.");
  const readLabel = selectedRecord.readMode === "full-article"
    ? "texto principal extraído"
    : selectedRecord.readMode === "full-article-cache"
      ? "texto principal recuperado do cache"
      : "fallback do feed da mesma matéria aplicado";
  await reportProgress(onProgress, READING_PROGRESS_END, "reading", `Matéria concluída: ${compact(selectedSourceName, 70)} — ${readLabel}.`);

  const quality = readingQuality(collected);
  if (!quality.generationAllowed) {
    throw new Error("O conteúdo disponível possui apenas título ou informação insuficiente. O carrossel foi bloqueado para evitar inferências sem evidência.");
  }
  const socialItems = [];
  const fallback = fallbackAnalysis(topic, collected, socialItems);
  await reportProgress(onProgress, 70, "analysis", "Extraindo fatos e evidências da matéria selecionada.");

  let factAnalysis = {
    questions: fallback.questions,
    entities: fallback.entities,
    facts: fallback.facts,
  };
  let slideSource = { slides: fallback.slides };
  let analysisMode = "fallback";
  let aiError = null;
  if (ai?.run) {
    try {
      const generatedFacts = await runAiFactAnalysis(ai, model, topic, collected[0], quality);
      if (!generatedFacts) throw new Error("A IA não retornou um mapa de fatos válido");
      factAnalysis = normalizeFactAnalysis(generatedFacts, fallback, collected[0]);
      await reportProgress(onProgress, 82, "analysis", "Redigindo sete slides somente com os fatos validados.");
      const generatedSlides = await runAiCarouselGeneration(ai, model, topic, factAnalysis, quality);
      if (!generatedSlides) throw new Error("A IA não retornou os sete slides em JSON válido");
      slideSource = generatedSlides;
      analysisMode = "ai";
    } catch (error) {
      aiError = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
      factAnalysis = {
        questions: fallback.questions,
        entities: fallback.entities,
        facts: fallback.facts,
      };
      slideSource = { slides: fallback.slides };
    }
  }
  const normalizedFallbackSlides = normalizeSlides({ slides: fallback.slides }, fallback, factAnalysis.facts);
  const normalizedSlides = normalizeSlides(slideSource, fallback, factAnalysis.facts);
  const validated = validateSlides(normalizedSlides, normalizedFallbackSlides, factAnalysis.facts, collected[0]);
  const editorialGate = {
    status: quality.copyAllowed && validated.report.passed ? "ready" : "review-required",
    copyAllowed: Boolean(quality.copyAllowed && validated.report.passed),
    reason: quality.copyAllowed
      ? validated.report.passed
        ? "Conteúdo amplo e roteiro validado."
        : "O roteiro precisa de revisão por inconsistências de validação."
      : `A qualidade foi classificada como ${quality.label.toLocaleLowerCase("pt-BR")}; revise a matéria antes de copiar.`,
  };

  await reportProgress(onProgress, 92, "finalizing", "Salvando o roteiro e encerrando o ciclo desta sugestão.");
  const selectedResolvedUrl = /^https?:\/\//i.test(String(selectedRecord?.extractionUrl || ""))
    && !isAggregatorHostname(canonicalHostname(selectedRecord.extractionUrl))
    ? selectedRecord.extractionUrl
    : selectedRecord?.url;
  const verificationLinks = (topic?.items || []).filter((item) => /^https?:\/\//i.test(String(item?.url || ""))).map((item) => {
    const selected = item === selectedItem || (selectedItem?.id && item?.id === selectedItem.id) || item?.url === selectedItem?.url;
    const url = selected && /^https?:\/\//i.test(String(selectedResolvedUrl || "")) ? selectedResolvedUrl : item.url;
    return {
      title: compact(item.title || "Notícia sem título", 180),
      sourceName: item.sourceName || item.collectorName || "Fonte não informada",
      publishedAt: item.publishedAt || null,
      url,
      ...(url !== item.url ? { originalUrl: item.url } : {}),
    };
  }).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);

  const liveSuccessful = collected.filter((item) => /^full-article/.test(item.readMode)).length;
  const fallbackSources = collected.filter((item) => !/^full-article/.test(item.readMode)).length;
  const blockedSources = collected.filter((item) => item.liveReadError).length;
  const alternativesAvailable = Math.max(0, (topic?.items || []).filter((item) => item?.kind !== "social" && /^https?:\/\//i.test(String(item?.url || "")) && item.url !== selectedRecord.url).length);
  const alternativesNotice = alternativesAvailable
    ? `${alternativesAvailable} ${alternativesAvailable === 1 ? "outra fonte disponível não foi lida" : "outras fontes disponíveis não foram lidas"}.`
    : "Não havia outra fonte de portal disponível para leitura.";
  const disclaimer = liveSuccessful
    ? `Roteiro gerado exclusivamente a partir de uma matéria: ${selectedRecord.sourceName}. ${alternativesNotice} Confirme nomes, números, datas e contexto no link original antes de publicar.`
    : quality.code === "broad"
      ? `A leitura direta da matéria selecionada em ${selectedRecord.sourceName} foi limitada; o roteiro usou somente o conteúdo amplo do feed dessa mesma matéria. Outras fontes não foram lidas.`
      : quality.code === "partial"
        ? `A leitura direta da matéria selecionada em ${selectedRecord.sourceName} foi limitada; o roteiro usou somente o resumo ou texto do feed dessa mesma matéria. Outras fontes não foram lidas.`
        : `Carrossel preliminar baseado somente no conteúdo limitado da matéria selecionada em ${selectedRecord.sourceName}. Faça apuração manual antes de publicar.`;

  return {
    language: "pt-BR",
    generatedAt: new Date().toISOString(),
    analysisMode,
    model: analysisMode === "ai" ? model : null,
    aiError,
    voiceTone: "Jornalístico, factual e explicativo",
    postModel: "Instagram · 7 slides · título + subtítulo",
    promptVersion: CAROUSEL_PROMPT_VERSION,
    cycle: {
      status: "completed",
      terminal: true,
      released: true,
      releasedAt: new Date().toISOString(),
      nextCycleAllowed: true,
    },
    reading: {
      basis: liveSuccessful ? "single-live-article-with-feed-fallback" : "single-feed-fallback",
      strategy: "single-best-source",
      cycleMode: "one-article-one-script",
      cycleComplete: true,
      cycleStatus: "released",
      nextCycleAllowed: true,
      requested: 1,
      successful: collected.length,
      failed: collected.length ? 0 : 1,
      selectedSource: publicArticleRecord(selectedRecord),
      alternativesAvailable,
      liveSuccessful,
      fallbackSources,
      blockedSources,
      totalWords: quality.totalWords,
      quality: quality.code,
      qualityLabel: quality.label,
      articleSources: quality.articleSources,
      contentSources: quality.contentSources,
      summarySources: quality.summarySources,
      titleOnlySources: quality.titleOnlySources,
      paragraphCount: quality.paragraphCount,
      uniqueTokenRatio: quality.uniqueTokenRatio,
      titleMatch: quality.titleMatch,
      sources: collected.map(publicArticleRecord),
    },
    questions: factAnalysis.questions,
    entities: factAnalysis.entities,
    facts: factAnalysis.facts,
    slides: validated.slides,
    validation: validated.report,
    editorialGate,
    verificationLinks,
    disclaimer,
    cacheKey: intelligentCarouselCacheKey("generated", topic),
  };
}

return { "ARTICLE_ANALYSIS_MODEL": ARTICLE_ANALYSIS_MODEL, "ARTICLE_READER_LIMIT": ARTICLE_READER_LIMIT, "extractArticleFromHtml": extractArticleFromHtml, "validateArticleUrl": validateArticleUrl, "readArticle": readArticle, "intelligentCarouselCacheKey": intelligentCarouselCacheKey, "buildIntelligentCarousel": buildIntelligentCarousel };
})();

const __module_src_collector_js = (() => {
const { buildTopics, clusterItems, titleTokens } = __module_src_clustering_js;
const { parseFeed, plainText, stableHash } = __module_src_parser_js;



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

function customSourceFeed(source) {
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

const FEEDS = Object.freeze([
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

const FEED_COUNTS = Object.freeze({
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

async function decodeFeedResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("Content-Type") || "";
  const headerCharset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1];
  const declarationSample = new TextDecoder("windows-1252").decode(bytes.slice(0, 300));
  const declarationCharset = /<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i.exec(declarationSample)?.[1];
  return new TextDecoder(normalizeCharset(headerCharset || declarationCharset)).decode(bytes);
}

async function collectFeed(feed, cutoff, fetcher = fetch, requestBudget = null) {
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

function uniqueItems(items, limit = Number.POSITIVE_INFINITY) {
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

async function collectDedicatedMonitoring(terms = [], cutoff, fetcher = fetch) {
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

async function collectBluesky(initialClusters, cutoff, fetcher = fetch) {
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

async function collectRound({ fetcher = fetch, now = new Date(), feeds = FEEDS, monitoringTerms = [], previousRound = null } = {}) {
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

return { "customSourceFeed": customSourceFeed, "FEEDS": FEEDS, "FEED_COUNTS": FEED_COUNTS, "decodeFeedResponse": decodeFeedResponse, "collectFeed": collectFeed, "uniqueItems": uniqueItems, "collectDedicatedMonitoring": collectDedicatedMonitoring, "collectBluesky": collectBluesky, "collectRound": collectRound };
})();

const __module_src_database_js = (() => {

const initializedBindings = new WeakSet();
const MAX_CUSTOM_SOURCES = 8;
const MAX_MONITORING_TERMS = 6;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    items_count INTEGER NOT NULL DEFAULT 0,
    topics_count INTEGER NOT NULL DEFAULT 0,
    sources_count INTEGER NOT NULL DEFAULT 0,
    social_items_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload_json TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_runs_completed ON runs(completed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_runs_status_completed ON runs(status, completed_at DESC)",
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS translation_cache (
    cache_key TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS intelligent_carousels (
    cache_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_run_topic ON intelligent_carousels(run_id, topic_id)",
  "CREATE INDEX IF NOT EXISTS idx_intelligent_carousels_expires ON intelligent_carousels(expires_at)",
  `CREATE TABLE IF NOT EXISTS intelligent_jobs (
    cache_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_job_id ON intelligent_jobs(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_intelligent_jobs_expires ON intelligent_jobs(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_read_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_article_read_cache_expires ON article_read_cache(expires_at)",
  `CREATE TABLE IF NOT EXISTS article_source_stats (
    hostname TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    total_words INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_article_source_stats_updated ON article_source_stats(updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS custom_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    region TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_custom_sources_active_name ON custom_sources(active, name)",
  `CREATE TABLE IF NOT EXISTS monitoring_terms (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    term_key TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_monitoring_terms_active_term ON monitoring_terms(active, term)",
];

async function ensureSchema(db) {
  if (!db) throw new Error("Binding D1 'DB' não configurado.");
  if (initializedBindings.has(db)) return;
  for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
  initializedBindings.add(db);
}

async function acquireLock(db, name, ttlMs, nowMs = Date.now()) {
  await ensureSchema(db);
  const token = crypto.randomUUID();
  const expiresAt = nowMs + ttlMs;
  await db
    .prepare(`
      INSERT INTO locks (name, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE locks.expires_at < ?
    `)
    .bind(name, token, expiresAt, nowMs)
    .run();
  const row = await db.prepare("SELECT token, expires_at FROM locks WHERE name = ?").bind(name).first();
  return row?.token === token ? { name, token, expiresAt } : null;
}

async function releaseLock(db, lock) {
  if (!db || !lock) return;
  await db.prepare("DELETE FROM locks WHERE name = ? AND token = ?").bind(lock.name, lock.token).run();
}

function customSourceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.source_url,
    region: row.region,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monitoringTermRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monitoringTermKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

async function listCustomSources(db, { activeOnly = false } = {}) {
  await ensureSchema(db);
  const result = await db
    .prepare(`SELECT * FROM custom_sources ${activeOnly ? "WHERE active = 1" : ""} ORDER BY active DESC, name COLLATE NOCASE`)
    .all();
  return (result?.results || []).map(customSourceRow);
}

async function createCustomSource(db, { name, url, region = "Brasil" } = {}) {
  await ensureSchema(db);
  const existing = await db.prepare("SELECT id FROM custom_sources WHERE source_url = ? LIMIT 1").bind(url).first();
  if (existing) throw new Error("Este endereço já está cadastrado.");
  const count = await db.prepare("SELECT COUNT(*) AS total FROM custom_sources WHERE active = 1").first();
  if (Number(count?.total) >= MAX_CUSTOM_SOURCES) throw new Error(`O limite é de ${MAX_CUSTOM_SOURCES} sites ativos.`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO custom_sources (id, name, source_url, region, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).bind(id, name, url, region, now, now).run();
  return customSourceRow(await db.prepare("SELECT * FROM custom_sources WHERE id = ?").bind(id).first());
}

async function setCustomSourceActive(db, id, active) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM custom_sources WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  if (active && Number(current.active) !== 1) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM custom_sources WHERE active = 1").first();
    if (Number(count?.total) >= MAX_CUSTOM_SOURCES) throw new Error(`O limite é de ${MAX_CUSTOM_SOURCES} sites ativos.`);
  }
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE custom_sources SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, updatedAt, id)
    .run();
  return customSourceRow(await db.prepare("SELECT * FROM custom_sources WHERE id = ?").bind(id).first());
}

async function deleteCustomSource(db, id) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM custom_sources WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  await db.prepare("DELETE FROM custom_sources WHERE id = ?").bind(id).run();
  return customSourceRow(current);
}

async function listMonitoringTerms(db, { activeOnly = false } = {}) {
  await ensureSchema(db);
  const result = await db
    .prepare(`SELECT * FROM monitoring_terms ${activeOnly ? "WHERE active = 1" : ""} ORDER BY active DESC, term COLLATE NOCASE`)
    .all();
  return (result?.results || []).map(monitoringTermRow);
}

async function createMonitoringTerm(db, term) {
  await ensureSchema(db);
  const termKey = monitoringTermKey(term);
  const existing = await db.prepare("SELECT id FROM monitoring_terms WHERE term_key = ? LIMIT 1").bind(termKey).first();
  if (existing) throw new Error("Este termo já está cadastrado.");
  const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
  if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO monitoring_terms (id, term, term_key, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(id, term, termKey, now, now).run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

async function setMonitoringTermActive(db, id, active) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  if (active && Number(current.active) !== 1) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM monitoring_terms WHERE active = 1").first();
    if (Number(count?.total) >= MAX_MONITORING_TERMS) throw new Error(`O limite é de ${MAX_MONITORING_TERMS} termos ativos.`);
  }
  const updatedAt = new Date().toISOString();
  await db.prepare("UPDATE monitoring_terms SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, updatedAt, id)
    .run();
  return monitoringTermRow(await db.prepare("SELECT * FROM monitoring_terms WHERE id = ?").bind(id).first());
}

async function deleteMonitoringTerm(db, id) {
  await ensureSchema(db);
  const current = await db.prepare("SELECT * FROM monitoring_terms WHERE id = ? LIMIT 1").bind(id).first();
  if (!current) return null;
  await db.prepare("DELETE FROM monitoring_terms WHERE id = ?").bind(id).run();
  return monitoringTermRow(current);
}

async function startRun(db, { id, triggerType, startedAt }) {
  await ensureSchema(db);
  await db
    .prepare(`
      INSERT INTO runs (
        id, trigger_type, status, started_at, completed_at,
        items_count, topics_count, sources_count, social_items_count,
        error, payload_json
      ) VALUES (?, ?, 'running', ?, ?, 0, 0, 0, 0, NULL, NULL)
    `)
    .bind(id, triggerType, startedAt, startedAt)
    .run();
  return { id, status: "running", startedAt };
}

async function saveRun(db, { id, triggerType, startedAt, payload }) {
  await ensureSchema(db);
  const safePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {
        ok: false,
        collectedAt: new Date().toISOString(),
        error: "A coleta terminou sem retornar dados válidos.",
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
      };
  const completedAt = safePayload.collectedAt || new Date().toISOString();
  const totals = safePayload.totals ?? {};
  const status = safePayload.ok ? "success" : "failed";
  const payloadJson = JSON.stringify(safePayload);
  const retentionCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const translationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const latestSummary = JSON.stringify({
    id,
    triggerType,
    status,
    completedAt,
    items: Number(totals.items) || 0,
    topics: Number(totals.topics) || 0,
    sources: Number(totals.sources) || 0,
  });

  await db.batch([
    db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          trigger_type = excluded.trigger_type,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          items_count = excluded.items_count,
          topics_count = excluded.topics_count,
          sources_count = excluded.sources_count,
          social_items_count = excluded.social_items_count,
          error = excluded.error,
          payload_json = excluded.payload_json
      `)
      .bind(
        id,
        triggerType,
        status,
        startedAt,
        completedAt,
        Number(totals.items) || 0,
        Number(totals.topics) || 0,
        Number(totals.sources) || 0,
        Number(totals.socialItems) || 0,
        safePayload.error || null,
        payloadJson,
      ),
    db
      .prepare(`
        INSERT INTO app_state (key, value, updated_at) VALUES ('latest_run', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .bind(latestSummary, completedAt),
    db.prepare("DELETE FROM runs WHERE completed_at < ?").bind(retentionCutoff),
    db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(Date.now() - 5 * 60 * 1000),
    db.prepare("DELETE FROM translation_cache WHERE updated_at < ?").bind(translationCutoff),
    db.prepare("DELETE FROM intelligent_carousels WHERE expires_at < ?").bind(new Date().toISOString()),
    db.prepare("DELETE FROM intelligent_jobs WHERE expires_at < ?").bind(new Date().toISOString()),
    db.prepare("DELETE FROM article_read_cache WHERE expires_at < ?").bind(new Date().toISOString()),
  ]);
  return { id, status, completedAt };
}

async function getCachedTranslations(db, keys = []) {
  await ensureSchema(db);
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const output = new Map();
  for (let offset = 0; offset < uniqueKeys.length; offset += 80) {
    const chunk = uniqueKeys.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT cache_key, translated_text FROM translation_cache WHERE cache_key IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      if (row?.cache_key && row?.translated_text) output.set(row.cache_key, row.translated_text);
    }
  }
  return output;
}

async function saveCachedTranslations(db, entries = []) {
  await ensureSchema(db);
  const validEntries = entries.filter((entry) => entry?.key && entry?.translatedText);
  const updatedAt = new Date().toISOString();
  for (let offset = 0; offset < validEntries.length; offset += 80) {
    const chunk = validEntries.slice(offset, offset + 80);
    await db.batch(chunk.map((entry) => db
      .prepare(`
        INSERT INTO translation_cache (cache_key, source_lang, target_lang, translated_text, updated_at)
        VALUES (?, ?, 'pt', ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          translated_text = excluded.translated_text,
          updated_at = excluded.updated_at
      `)
      .bind(entry.key, entry.sourceLanguage, entry.translatedText, updatedAt)));
  }
}

async function getLatestRound(db) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT id, trigger_type, completed_at, payload_json FROM runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1")
    .first();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return { ...payload, runId: row.id, triggerType: row.trigger_type, storedAt: row.completed_at };
  } catch {
    throw new Error("A última ronda armazenada está corrompida.");
  }
}

async function getRunHistory(db, limit = 30) {
  await ensureSchema(db);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs ORDER BY completed_at DESC LIMIT ?
    `)
    .bind(safeLimit)
    .all();
  return result?.results ?? [];
}

async function getRunStatus(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at,
             items_count, topics_count, sources_count, social_items_count, error
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  return row ?? null;
}

async function getRunPayload(db, id) {
  await ensureSchema(db);
  const row = await db
    .prepare(`
      SELECT id, trigger_type, status, started_at, completed_at, error, payload_json
      FROM runs WHERE id = ? LIMIT 1
    `)
    .bind(id)
    .first();
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error("Os dados desta ronda estão corrompidos.");
    }
  }
  return {
    id: row.id,
    triggerType: row.trigger_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    payload,
  };
}

async function getArticleReadCache(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM article_read_cache WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function saveArticleReadCache(db, cacheKey, payload, ttlHours = 12) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 12) * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO article_read_cache (cache_key, payload_json, updated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(cacheKey, JSON.stringify(payload), updatedAt, expiresAt).run();
  return { updatedAt, expiresAt };
}

function hostnameFromUrl(value) {
  try { return new URL(String(value || "")).hostname.toLocaleLowerCase("pt-BR").replace(/^www\./, ""); } catch { return ""; }
}

async function getArticleSourceStats(db, urls = []) {
  await ensureSchema(db);
  const hostnames = [...new Set(urls.map(hostnameFromUrl).filter(Boolean))];
  if (!hostnames.length) return {};
  const output = {};
  for (let offset = 0; offset < hostnames.length; offset += 80) {
    const chunk = hostnames.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT hostname, attempts, successes, total_words, updated_at FROM article_source_stats WHERE hostname IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      output[row.hostname] = {
        attempts: Number(row.attempts) || 0,
        successes: Number(row.successes) || 0,
        totalWords: Number(row.total_words) || 0,
        updatedAt: row.updated_at,
      };
    }
  }
  return output;
}

async function recordArticleSourceAttempt(db, { url, success, wordCount = 0 } = {}) {
  await ensureSchema(db);
  const hostname = hostnameFromUrl(url);
  if (!hostname) return null;
  const updatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO article_source_stats (hostname, attempts, successes, total_words, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      attempts = article_source_stats.attempts + 1,
      successes = article_source_stats.successes + excluded.successes,
      total_words = article_source_stats.total_words + excluded.total_words,
      updated_at = excluded.updated_at
  `).bind(hostname, success ? 1 : 0, Math.max(0, Number(wordCount) || 0), updatedAt).run();
  return { hostname, updatedAt };
}


async function getIntelligentCarousel(db, cacheKey) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM intelligent_carousels WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  if (!row?.payload_json || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function saveIntelligentCarousel(db, { cacheKey, runId, topicId, payload, ttlHours = 48 }) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlHours) || 48) * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`
      INSERT INTO intelligent_carousels (cache_key, run_id, topic_id, payload_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        run_id = excluded.run_id,
        topic_id = excluded.topic_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    .bind(cacheKey, runId, topicId, JSON.stringify(payload), updatedAt, expiresAt)
    .run();
  return { updatedAt, expiresAt };
}


function parseIntelligentJob(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch {}
  }
  const updatedAt = row.updated_at || row.created_at;
  const active = row.status === "queued" || row.status === "running";
  return {
    cacheKey: row.cache_key,
    jobId: row.job_id,
    runId: row.run_id,
    topicId: row.topic_id,
    status: row.status,
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    message: row.message || "",
    error: row.error || null,
    payload,
    createdAt: row.created_at,
    updatedAt,
    expiresAt: row.expires_at,
    stale: active && Date.now() - Date.parse(updatedAt) > 10 * 60 * 1000,
  };
}

async function getIntelligentJob(db, jobId) {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE job_id = ? LIMIT 1")
    .bind(jobId)
    .first();
  return parseIntelligentJob(row);
}

async function createIntelligentJob(db, {
  cacheKey,
  runId,
  topicId,
  staleMs = 10 * 60 * 1000,
  ttlMinutes = 120,
  replaceCompleted = false,
} = {}) {
  await ensureSchema(db);
  const existingRow = await db
    .prepare("SELECT * FROM intelligent_jobs WHERE cache_key = ? LIMIT 1")
    .bind(cacheKey)
    .first();
  const existing = parseIntelligentJob(existingRow);
  const existingAge = existing?.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : Number.POSITIVE_INFINITY;
  if (existing && (
    (["queued", "running"].includes(existing.status) && existingAge <= staleMs)
    || (!replaceCompleted && existing.status === "succeeded" && existing.payload)
  )) {
    return { created: false, job: existing };
  }

  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO intelligent_jobs (
      cache_key, job_id, run_id, topic_id, status, progress, message, error,
      payload_json, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, 'queued', 1, ?, NULL, NULL, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      job_id = excluded.job_id,
      run_id = excluded.run_id,
      topic_id = excluded.topic_id,
      status = excluded.status,
      progress = excluded.progress,
      message = excluded.message,
      error = NULL,
      payload_json = NULL,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(cacheKey, jobId, runId, topicId, "Leitura adicionada à fila.", now, now, expiresAt).run();
  return {
    created: true,
    job: {
      cacheKey,
      jobId,
      runId,
      topicId,
      status: "queued",
      progress: 1,
      message: "Leitura adicionada à fila.",
      error: null,
      payload: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      stale: false,
    },
  };
}

async function updateIntelligentJob(db, {
  jobId,
  status,
  progress = 0,
  message = "",
  error = null,
  payload = null,
  ttlMinutes = 120,
} = {}) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(15, Number(ttlMinutes) || 120) * 60 * 1000).toISOString();
  await db.prepare(`
    UPDATE intelligent_jobs
    SET status = ?, progress = ?, message = ?, error = ?, payload_json = ?, updated_at = ?, expires_at = ?
    WHERE job_id = ?
  `).bind(
    status,
    Math.max(0, Math.min(100, Number(progress) || 0)),
    message || "",
    error ? String(error).slice(0, 300) : null,
    payload ? JSON.stringify(payload) : null,
    updatedAt,
    expiresAt,
    jobId,
  ).run();
  return getIntelligentJob(db, jobId);
}

async function databaseHealth(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT 1 AS ok").first();
  return Number(row?.ok) === 1;
}

async function databaseSelfTest(db) {
  await ensureSchema(db);
  const id = `self-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let lock = null;
  try {
    await db
      .prepare(`
        INSERT INTO runs (
          id, trigger_type, status, started_at, completed_at,
          items_count, topics_count, sources_count, social_items_count,
          error, payload_json
        ) VALUES (?, 'self-test', 'self-test', ?, ?, 0, 0, 0, 0, NULL, NULL)
      `)
      .bind(id, now, now)
      .run();
    const written = await db.prepare("SELECT id FROM runs WHERE id = ?").bind(id).first();
    lock = await acquireLock(db, `self-test-lock-${id}`, 10_000);
    return written?.id === id && Boolean(lock);
  } finally {
    await releaseLock(db, lock);
    await db.prepare("DELETE FROM runs WHERE id = ?").bind(id).run();
  }
}

return { "MAX_CUSTOM_SOURCES": MAX_CUSTOM_SOURCES, "MAX_MONITORING_TERMS": MAX_MONITORING_TERMS, "ensureSchema": ensureSchema, "acquireLock": acquireLock, "releaseLock": releaseLock, "listCustomSources": listCustomSources, "createCustomSource": createCustomSource, "setCustomSourceActive": setCustomSourceActive, "deleteCustomSource": deleteCustomSource, "listMonitoringTerms": listMonitoringTerms, "createMonitoringTerm": createMonitoringTerm, "setMonitoringTermActive": setMonitoringTermActive, "deleteMonitoringTerm": deleteMonitoringTerm, "startRun": startRun, "saveRun": saveRun, "getCachedTranslations": getCachedTranslations, "saveCachedTranslations": saveCachedTranslations, "getLatestRound": getLatestRound, "getRunHistory": getRunHistory, "getRunStatus": getRunStatus, "getRunPayload": getRunPayload, "getArticleReadCache": getArticleReadCache, "saveArticleReadCache": saveArticleReadCache, "getArticleSourceStats": getArticleSourceStats, "recordArticleSourceAttempt": recordArticleSourceAttempt, "getIntelligentCarousel": getIntelligentCarousel, "saveIntelligentCarousel": saveIntelligentCarousel, "getIntelligentJob": getIntelligentJob, "createIntelligentJob": createIntelligentJob, "updateIntelligentJob": updateIntelligentJob, "databaseHealth": databaseHealth, "databaseSelfTest": databaseSelfTest };
})();

const __module_src_translation_js = (() => {
const { buildTopics } = __module_src_clustering_js;
const { getCachedTranslations, saveCachedTranslations } = __module_src_database_js;
const { plainText, stableHash } = __module_src_parser_js;




const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const SPANISH_SOURCES = new Set(["El País", "Infobae"]);
const PORTUGUESE_WORDS = /\b(que|para|com|uma|das|dos|não|mais|sobre|após|entre|governo|notícia|brasil|mundo|novo|nova|segundo|diz)\b/i;

function cleanTranslation(value, limit) {
  const text = plainText(value).replace(/^(["“”']+)|(["“”']+)$/g, "").trim();
  return text.slice(0, limit);
}

function sourceLanguage(item) {
  return SPANISH_SOURCES.has(item?.collectorName || item?.sourceName) ? "es" : "en";
}

function translationKey(text, language) {
  return `pt-v1-${stableHash(`${language}|${plainText(text)}`)}`;
}

function isLikelyPortuguese(value) {
  const text = plainText(value);
  if (!text) return false;
  return /[ãõçáéíóúâêôà]/i.test(text) || PORTUGUESE_WORDS.test(text);
}

async function withTimeout(promise, milliseconds = 12_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Tempo limite da tradução excedido")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function translateText(ai, text, language) {
  const source = plainText(text);
  if (!source || !ai?.run) return null;
  const response = await withTimeout(ai.run(TRANSLATION_MODEL, {
    text: source,
    source_lang: language,
    target_lang: "pt",
  }));
  const translated = response?.translated_text || response?.result?.translated_text;
  return cleanTranslation(translated, Math.max(240, source.length * 3));
}

async function runLimited(entries, limit, worker) {
  const output = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(entries[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

async function translateWorldItems(items, { ai, cached = new Map(), concurrency = 8 } = {}) {
  const worldItems = items.filter((item) => item?.region === "Mundo");
  const requests = new Map();
  let cachedFieldCount = 0;
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    for (const [field, value] of [["title", item.title], ["description", item.description]]) {
      const text = plainText(value);
      if (!text) continue;
      const key = translationKey(text, language);
      if (cached.has(key)) cachedFieldCount += 1;
      if (!cached.has(key) && !requests.has(key)) requests.set(key, { key, text, language, field });
    }
  }

  const generatedEntries = (await runLimited([...requests.values()], concurrency, async (entry) => {
    try {
      const translatedText = await translateText(ai, entry.text, entry.language);
      return translatedText ? { key: entry.key, sourceLanguage: entry.language, translatedText } : null;
    } catch {
      return null;
    }
  })).filter(Boolean);
  for (const entry of generatedEntries) cached.set(entry.key, entry.translatedText);

  const translatedItems = [];
  let omittedItems = 0;
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    const title = cached.get(translationKey(item.title, language));
    if (!title) {
      omittedItems += 1;
      continue;
    }
    const description = item.description
      ? cached.get(translationKey(item.description, language)) || ""
      : "";
    const translatedTitle = cleanTranslation(title, 240);
    const translatedDescription = cleanTranslation(description, 900);
    translatedItems.push({
      ...item,
      title: translatedTitle,
      description: translatedDescription,
      content: translatedDescription || translatedTitle,
      contentSource: translatedDescription ? "translated-feed-description" : "translated-title",
      contentWordCount: plainText(translatedDescription || translatedTitle).split(/\s+/).filter(Boolean).length,
      sourceLanguage: language,
      targetLanguage: "pt-BR",
      translationStatus: description || !item.description ? "translated" : "partial",
    });
  }

  return {
    translatedItems,
    omittedItems,
    generatedEntries,
    cachedFieldCount,
  };
}

function recalculateSources(sources, items, omittedWorldItems) {
  return (sources || []).map((source) => {
    const count = items.filter((item) => item.collectorName === source.name).length;
    if (source.region === "Mundo") {
      const collected = Number(source.count) || 0;
      const omitted = Math.max(0, collected - count);
      return {
        ...source,
        count,
        ok: count > 0,
        error: count > 0
          ? omitted > 0 ? `${omitted} conteúdo(s) omitido(s) porque a tradução não foi concluída.` : null
          : source.error || "Tradução para português indisponível nesta ronda.",
        translation: count > 0 ? omitted > 0 ? "partial" : "translated" : "failed",
      };
    }
    if (source.region === "Rede") {
      return { ...source, count, ok: source.ok && (count > 0 || Number(source.count) === 0) };
    }
    return source;
  });
}

async function translateRoundPayload(payload, { ai, db } = {}) {
  if (!payload?.ok || !Array.isArray(payload.items)) return payload;
  const worldItems = payload.items.filter((item) => item?.region === "Mundo");
  const brazilItems = payload.items.filter((item) => item?.region !== "Mundo" && item?.region !== "Rede");
  const portugueseSocialItems = payload.items.filter((item) => item?.region === "Rede" && isLikelyPortuguese(item.title));
  const keys = [];
  for (const item of worldItems) {
    const language = sourceLanguage(item);
    if (item.title) keys.push(translationKey(item.title, language));
    if (item.description) keys.push(translationKey(item.description, language));
  }
  const cached = db ? await getCachedTranslations(db, keys) : new Map();
  const translated = await translateWorldItems(worldItems, { ai, cached });
  if (db && translated.generatedEntries.length) await saveCachedTranslations(db, translated.generatedEntries);

  const finalItems = [...brazilItems, ...translated.translatedItems, ...portugueseSocialItems];
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(finalItems, collectedAt, 40);
  const sourceCount = new Set(finalItems.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = finalItems.filter((item) => item.kind === "social").length;
  const sources = recalculateSources(payload.sources, finalItems, translated.omittedItems);

  return {
    ...payload,
    sources,
    totals: {
      items: finalItems.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(payload.dedicatedMonitoring?.items?.length) || 0,
    },
    items: finalItems,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      translatedWorldItems: translated.translatedItems.length,
      omittedWorldItems: translated.omittedItems,
      generatedFields: translated.generatedEntries.length,
      cachedFields: translated.cachedFieldCount,
    },
  };
}

function portugueseOnlyFallback(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) return payload;
  const items = payload.items.filter((item) => item?.region !== "Mundo" && (item?.region !== "Rede" || isLikelyPortuguese(item.title)));
  const collectedAt = new Date(payload.collectedAt || Date.now());
  const topics = buildTopics(items, collectedAt, 40);
  const sourceCount = new Set(items.map((item) => item.sourceName).filter(Boolean)).size;
  const socialItems = items.filter((item) => item.kind === "social").length;
  const omittedWorldItems = payload.items.filter((item) => item?.region === "Mundo").length;
  return {
    ...payload,
    sources: recalculateSources(payload.sources, items, omittedWorldItems),
    totals: {
      items: items.length,
      topics: topics.length,
      sources: sourceCount,
      socialItems,
      dedicatedItems: Number(payload.dedicatedMonitoring?.items?.length) || 0,
    },
    items,
    topics,
    translation: {
      targetLanguage: "pt-BR",
      model: TRANSLATION_MODEL,
      portugueseOnly: true,
      translatedWorldItems: 0,
      omittedWorldItems,
      generatedFields: 0,
      cachedFields: 0,
      error: "Tradução indisponível; conteúdos internacionais não traduzidos foram omitidos.",
    },
  };
}

return { "TRANSLATION_MODEL": TRANSLATION_MODEL, "sourceLanguage": sourceLanguage, "translationKey": translationKey, "isLikelyPortuguese": isLikelyPortuguese, "translateText": translateText, "translateWorldItems": translateWorldItems, "translateRoundPayload": translateRoundPayload, "portugueseOnlyFallback": portugueseOnlyFallback };
})();

const __module_src_ui_generated_js = (() => {

// Arquivo gerado. Não edite manualmente.
const UI_ASSETS = Object.freeze({"/":{"contentType":"text/html; charset=utf-8","body":"<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"theme-color\" content=\"#f3f6f4\">\n  <meta name=\"description\" content=\"Ronda editorial automática para acompanhamento de portais e fontes públicas.\">\n  <title>Ronda Editorial 24h</title>\n  <link rel=\"stylesheet\" href=\"/styles.css?v=2.4.3\">\n</head>\n<body>\n  <main class=\"app\">\n    <aside class=\"sidebar\">\n      <button class=\"brand\" id=\"goTop\" type=\"button\" aria-label=\"Voltar ao topo\">RE</button>\n      <nav aria-label=\"Navegação principal\">\n        <button class=\"nav active\" id=\"navRound\" type=\"button\"><span class=\"nav-icon\">R</span><span>Ronda</span></button>\n        <button class=\"nav\" id=\"navSources\" type=\"button\"><span class=\"nav-icon\">F</span><span>Fontes</span></button>\n        <button class=\"nav\" id=\"navCustomSources\" type=\"button\"><span class=\"nav-icon\">S</span><span>Sites</span></button>\n        <button class=\"nav\" id=\"navMonitoring\" type=\"button\"><span class=\"nav-icon\">T</span><span>Termos</span></button>\n        <button class=\"nav\" id=\"navHistory\" type=\"button\"><span class=\"nav-icon\">H</span><span>Histórico</span></button>\n      </nav>\n      <button class=\"nav settings\" id=\"openSettings\" type=\"button\"><span class=\"nav-icon\">·</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class=\"workspace\" id=\"workspaceTop\">\n      <header class=\"topbar\">\n        <div><p class=\"eyebrow\">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class=\"top-actions\">\n          <button class=\"icon-button\" id=\"settingsButton\" type=\"button\" aria-label=\"Abrir ajustes\">⚙</button>\n          <button class=\"run-round\" id=\"runRound\" type=\"button\"><span>↻</span>Executar ronda</button>\n          <div class=\"status\"><span class=\"live\" id=\"liveDot\"></span><div><strong id=\"statusLabel\">Conectando</strong><small id=\"statusSub\">Verificando o serviço online</small></div></div>\n        </div>\n      </header>\n\n      <div class=\"notice\"><span>Webapp</span><strong id=\"automationText\">Automação online em verificação.</strong> A ronda e o monitoramento dedicado continuam no Cloudflare mesmo com esta janela fechada; resultados de termos aparecem somente na aba Termos.</div>\n      <div class=\"source-health\" id=\"sourceHealth\"><span class=\"health-label\">Fontes ainda não consultadas</span></div>\n\n      <section class=\"sources-view\" id=\"sourcesView\" hidden aria-labelledby=\"sourcesTitle\">\n        <div class=\"sources-heading\">\n          <div><p class=\"eyebrow\">Portais monitorados</p><h2 id=\"sourcesTitle\">Fontes da ronda</h2><p>Clique em um portal para ver somente as notícias recolhidas dele. Conteúdos do Mundo são traduzidos automaticamente para português.</p></div>\n          <button class=\"secondary\" id=\"showAllSources\" type=\"button\">Ver todas as notícias</button>\n        </div>\n        <div class=\"source-portal-grid\" id=\"sourcePortalGrid\"></div>\n      </section>\n\n      <section class=\"management-view\" id=\"customSourcesView\" hidden aria-labelledby=\"customSourcesTitle\">\n        <div class=\"management-heading\">\n          <div><p class=\"eyebrow\">Configuração persistente</p><h2 id=\"customSourcesTitle\">Sites cadastrados</h2><p>Adicione um site ou endereço RSS. O Worker tentará o feed informado e usará o Google Notícias por domínio quando necessário.</p></div>\n          <span id=\"customSourcesLimit\">0/8 ativos</span>\n        </div>\n        <div class=\"background-note\"><strong>Funciona com a janela fechada</strong><span>Os sites ativos são lidos pelo Cron do Cloudflare a cada cinco minutos e passam a integrar a aba Ronda.</span></div>\n        <form class=\"config-form config-form-sites\" id=\"customSourceForm\">\n          <label><span>Nome do site</span><input id=\"customSourceName\" maxlength=\"80\" required placeholder=\"Ex.: Jornal local\"></label>\n          <label><span>URL do site ou RSS</span><input id=\"customSourceUrl\" type=\"url\" maxlength=\"500\" required placeholder=\"https://exemplo.com/feed/\"></label>\n          <label><span>Região</span><select id=\"customSourceRegion\"><option value=\"Brasil\">Brasil</option><option value=\"Mundo\">Mundo</option></select></label>\n          <button class=\"primary\" type=\"submit\">Cadastrar site</button>\n        </form>\n        <p class=\"config-message\" id=\"customSourceMessage\"></p>\n        <div class=\"config-list\" id=\"customSourcesList\"><div class=\"loading-row\">Carregando sites cadastrados…</div></div>\n      </section>\n\n      <section class=\"management-view\" id=\"monitoringView\" hidden aria-labelledby=\"monitoringTitle\">\n        <div class=\"management-heading\">\n          <div><p class=\"eyebrow\">Acompanhamento exclusivo</p><h2 id=\"monitoringTitle\">Monitoramento dedicado</h2><p>Cadastre nomes, marcas ou assuntos. Essas notícias ficam isoladas nesta aba e nunca entram na Ronda principal.</p></div>\n          <span id=\"monitoringTermsLimit\">0/6 ativos</span>\n        </div>\n        <div class=\"background-note\"><strong>Busca automática contínua</strong><span>Enquanto o termo estiver ativo, o Cron buscará novas notícias mesmo sem navegador aberto.</span></div>\n        <form class=\"config-form config-form-terms\" id=\"monitoringTermForm\">\n          <label><span>Termo para acompanhar</span><input id=\"monitoringTermInput\" maxlength=\"80\" required placeholder=\"Ex.: Vini Jr\"></label>\n          <button class=\"primary\" type=\"submit\">Adicionar termo</button>\n        </form>\n        <p class=\"config-message\" id=\"monitoringTermMessage\"></p>\n        <div class=\"config-list compact-config-list\" id=\"monitoringTermsList\"><div class=\"loading-row\">Carregando termos…</div></div>\n        <div class=\"dedicated-heading\"><div><p class=\"eyebrow\">Última ronda automática</p><h3>Notícias dos termos ativos</h3></div><span id=\"dedicatedMonitoringMeta\">Nenhum resultado</span></div>\n        <div class=\"term-filters\" id=\"monitoringTermFilters\"></div>\n        <div class=\"dedicated-news-list\" id=\"dedicatedNewsList\"><div class=\"empty\"><strong>Nenhum termo monitorado</strong><span>Cadastre um termo para iniciar a busca dedicada.</span></div></div>\n      </section>\n\n      <div class=\"round-view\" id=\"roundView\">\n      <section class=\"summary\" aria-label=\"Resumo da ronda\">\n        <div><strong id=\"summaryContents\">0</strong><span>novos conteúdos</span><small>período selecionado</small></div>\n        <div><strong id=\"summaryTopics\">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id=\"summaryChannels\">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class=\"attention\"><strong id=\"summaryUrgent\">0</strong><span>pautar agora</span><small>alta recorrência</small></div>\n      </section>\n\n      <section class=\"controls\" aria-label=\"Filtros da ronda\">\n        <label class=\"search\"><span>⌕</span><input id=\"searchInput\" placeholder=\"Buscar assunto, veículo ou canal\" aria-label=\"Buscar assunto, veículo ou canal\"></label>\n        <div class=\"segmented\" id=\"periodFilter\" aria-label=\"Período\">\n          <button data-value=\"5\" type=\"button\">5 min</button><button data-value=\"60\" type=\"button\">1h</button><button data-value=\"360\" type=\"button\">6h</button><button class=\"active\" data-value=\"1440\" type=\"button\">24h</button>\n        </div>\n        <div class=\"segmented\" id=\"sourceFilter\" aria-label=\"Tipo de fonte\">\n          <button class=\"active\" data-value=\"Todos\" type=\"button\">Todos</button><button data-value=\"Portal\" type=\"button\">Portais</button><button data-value=\"Rede\" type=\"button\">Redes</button>\n        </div>\n        <div class=\"segmented\" id=\"regionFilter\" aria-label=\"Região das fontes\">\n          <button class=\"active\" data-value=\"Todas\" type=\"button\">Todas regiões</button><button data-value=\"Brasil\" type=\"button\">Brasil</button><button data-value=\"Mundo\" type=\"button\">Mundo</button>\n        </div>\n      </section>\n\n      <section class=\"editoria-controls\" aria-label=\"Filtrar por editoria\">\n        <span>Editorias</span>\n        <div class=\"editoria-filter\" id=\"editoriaFilter\">\n          <button class=\"active\" data-editoria=\"Todas\" type=\"button\">Todas</button>\n          <button data-editoria=\"Notícias\" type=\"button\">Notícias</button>\n          <button data-editoria=\"Política\" type=\"button\">Política</button>\n          <button data-editoria=\"Esportes\" type=\"button\">Esportes</button>\n          <button data-editoria=\"Entretenimento\" type=\"button\">Entretenimento</button>\n          <button data-editoria=\"Fofoca e Celebridades\" type=\"button\">Fofoca e Celebridades</button>\n          <button data-editoria=\"Reality Shows\" type=\"button\">Reality Shows</button>\n          <button data-editoria=\"Curiosidades e Ciência Pop\" type=\"button\">Curiosidades e Ciência Pop</button>\n          <button data-editoria=\"Conteúdo Viral e Redes Sociais\" type=\"button\">Viral e Redes Sociais</button>\n          <button data-editoria=\"Luto e Obituário\" type=\"button\">Luto e Obituário</button>\n          <button data-editoria=\"Segurança e Justiça\" type=\"button\">Segurança e Justiça</button>\n          <button data-editoria=\"Economia\" type=\"button\">Economia</button>\n          <button data-editoria=\"Mundo\" type=\"button\">Mundo</button>\n          <button data-editoria=\"Tecnologia\" type=\"button\">Tecnologia</button>\n          <button data-editoria=\"Saúde\" type=\"button\">Saúde</button>\n        </div>\n      </section>\n\n      <div class=\"portal-filter\" id=\"portalFilter\" hidden><span>Exibindo somente:</span><strong id=\"portalFilterName\"></strong><button id=\"clearPortalFilter\" type=\"button\">Remover filtro ×</button></div>\n\n      <div class=\"heading\"><div><h2>Assuntos em destaque</h2><p>Ordenados por relevância editorial, recorrência e atualidade</p></div><span class=\"last-update\" id=\"lastUpdate\">Sem coleta</span></div>\n      <section class=\"grid\" id=\"topicsGrid\" aria-live=\"polite\"></section>\n      </div>\n    </section>\n  </main>\n\n  <div class=\"modal-backdrop\" id=\"settingsModal\" hidden>\n    <section class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"settingsTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Segurança</p><h2 id=\"settingsTitle\">Ajustes da operação</h2></div><button class=\"close-modal\" data-close=\"settingsModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <p class=\"modal-copy\">Se o Worker possuir a variável secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class=\"field\"><span>Chave para executar ronda manual</span><input id=\"operationToken\" type=\"password\" autocomplete=\"off\" placeholder=\"Opcional quando não há proteção\"></label>\n      <p class=\"field-message\" id=\"tokenMessage\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"settingsModal\" type=\"button\">Cancelar</button><button class=\"primary\" id=\"saveSettings\" type=\"button\">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"historyModal\" hidden>\n    <section class=\"modal modal-wide\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"historyTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Últimas 48 horas</p><h2 id=\"historyTitle\">Histórico de rondas</h2></div><button class=\"close-modal\" data-close=\"historyModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <button class=\"history-back\" id=\"historyBack\" type=\"button\" hidden>← Voltar para todas as rondas</button>\n      <div class=\"history-list\" id=\"historyList\"><div class=\"loading-row\">Carregando histórico…</div></div>\n      <div class=\"history-detail\" id=\"historyDetail\" hidden></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"carouselModal\" hidden>\n    <section class=\"modal modal-wide carousel-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"carouselTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Apoio editorial</p><h2 id=\"carouselTitle\">Roteiro para carrossel</h2></div><button class=\"close-modal\" data-close=\"carouselModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <div class=\"carousel-loading\" id=\"carouselLoading\" hidden><span class=\"reader-spinner\">↻</span><div><strong>Abrindo uma matéria…</strong><small>Selecionando uma fonte, extraindo o texto e encerrando o ciclo após o roteiro.</small></div></div>\n      <div class=\"carousel-meta\" id=\"carouselMeta\"></div>\n      <section class=\"carousel-reading\" id=\"carouselReading\" hidden aria-label=\"Resumo da leitura inteligente\"></section>\n      <section class=\"carousel-evidence\" id=\"carouselEvidence\" hidden aria-label=\"Mapa de fatos e evidências\"></section>\n      <section class=\"carousel-analysis\" id=\"carouselAnalysis\" hidden aria-label=\"Interpretação da notícia\"></section>\n      <section class=\"carousel-entities\" id=\"carouselEntities\" hidden aria-label=\"Dados estruturados extraídos\"></section>\n      <div class=\"carousel-slides\" id=\"carouselSlides\"></div>\n      <section class=\"carousel-sources\" id=\"carouselSources\" aria-label=\"Links para apuração\"></section>\n      <p class=\"carousel-disclaimer\" id=\"carouselDisclaimer\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"carouselModal\" type=\"button\">Fechar</button><button class=\"primary\" id=\"copyCarousel\" type=\"button\" disabled>Copiar roteiro</button></div>\n      <p class=\"copy-message\" id=\"copyCarouselMessage\"></p>\n    </section>\n  </div>\n\n  <script src=\"/app.js?v=2.4.3\" defer></script>\n</body>\n</html>\n"},"/index.html":{"contentType":"text/html; charset=utf-8","body":"<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"theme-color\" content=\"#f3f6f4\">\n  <meta name=\"description\" content=\"Ronda editorial automática para acompanhamento de portais e fontes públicas.\">\n  <title>Ronda Editorial 24h</title>\n  <link rel=\"stylesheet\" href=\"/styles.css?v=2.4.3\">\n</head>\n<body>\n  <main class=\"app\">\n    <aside class=\"sidebar\">\n      <button class=\"brand\" id=\"goTop\" type=\"button\" aria-label=\"Voltar ao topo\">RE</button>\n      <nav aria-label=\"Navegação principal\">\n        <button class=\"nav active\" id=\"navRound\" type=\"button\"><span class=\"nav-icon\">R</span><span>Ronda</span></button>\n        <button class=\"nav\" id=\"navSources\" type=\"button\"><span class=\"nav-icon\">F</span><span>Fontes</span></button>\n        <button class=\"nav\" id=\"navCustomSources\" type=\"button\"><span class=\"nav-icon\">S</span><span>Sites</span></button>\n        <button class=\"nav\" id=\"navMonitoring\" type=\"button\"><span class=\"nav-icon\">T</span><span>Termos</span></button>\n        <button class=\"nav\" id=\"navHistory\" type=\"button\"><span class=\"nav-icon\">H</span><span>Histórico</span></button>\n      </nav>\n      <button class=\"nav settings\" id=\"openSettings\" type=\"button\"><span class=\"nav-icon\">·</span><span>Ajustes</span></button>\n    </aside>\n\n    <section class=\"workspace\" id=\"workspaceTop\">\n      <header class=\"topbar\">\n        <div><p class=\"eyebrow\">Monitoramento editorial</p><h1>Ronda Editorial <span>24h</span></h1></div>\n        <div class=\"top-actions\">\n          <button class=\"icon-button\" id=\"settingsButton\" type=\"button\" aria-label=\"Abrir ajustes\">⚙</button>\n          <button class=\"run-round\" id=\"runRound\" type=\"button\"><span>↻</span>Executar ronda</button>\n          <div class=\"status\"><span class=\"live\" id=\"liveDot\"></span><div><strong id=\"statusLabel\">Conectando</strong><small id=\"statusSub\">Verificando o serviço online</small></div></div>\n        </div>\n      </header>\n\n      <div class=\"notice\"><span>Webapp</span><strong id=\"automationText\">Automação online em verificação.</strong> A ronda e o monitoramento dedicado continuam no Cloudflare mesmo com esta janela fechada; resultados de termos aparecem somente na aba Termos.</div>\n      <div class=\"source-health\" id=\"sourceHealth\"><span class=\"health-label\">Fontes ainda não consultadas</span></div>\n\n      <section class=\"sources-view\" id=\"sourcesView\" hidden aria-labelledby=\"sourcesTitle\">\n        <div class=\"sources-heading\">\n          <div><p class=\"eyebrow\">Portais monitorados</p><h2 id=\"sourcesTitle\">Fontes da ronda</h2><p>Clique em um portal para ver somente as notícias recolhidas dele. Conteúdos do Mundo são traduzidos automaticamente para português.</p></div>\n          <button class=\"secondary\" id=\"showAllSources\" type=\"button\">Ver todas as notícias</button>\n        </div>\n        <div class=\"source-portal-grid\" id=\"sourcePortalGrid\"></div>\n      </section>\n\n      <section class=\"management-view\" id=\"customSourcesView\" hidden aria-labelledby=\"customSourcesTitle\">\n        <div class=\"management-heading\">\n          <div><p class=\"eyebrow\">Configuração persistente</p><h2 id=\"customSourcesTitle\">Sites cadastrados</h2><p>Adicione um site ou endereço RSS. O Worker tentará o feed informado e usará o Google Notícias por domínio quando necessário.</p></div>\n          <span id=\"customSourcesLimit\">0/8 ativos</span>\n        </div>\n        <div class=\"background-note\"><strong>Funciona com a janela fechada</strong><span>Os sites ativos são lidos pelo Cron do Cloudflare a cada cinco minutos e passam a integrar a aba Ronda.</span></div>\n        <form class=\"config-form config-form-sites\" id=\"customSourceForm\">\n          <label><span>Nome do site</span><input id=\"customSourceName\" maxlength=\"80\" required placeholder=\"Ex.: Jornal local\"></label>\n          <label><span>URL do site ou RSS</span><input id=\"customSourceUrl\" type=\"url\" maxlength=\"500\" required placeholder=\"https://exemplo.com/feed/\"></label>\n          <label><span>Região</span><select id=\"customSourceRegion\"><option value=\"Brasil\">Brasil</option><option value=\"Mundo\">Mundo</option></select></label>\n          <button class=\"primary\" type=\"submit\">Cadastrar site</button>\n        </form>\n        <p class=\"config-message\" id=\"customSourceMessage\"></p>\n        <div class=\"config-list\" id=\"customSourcesList\"><div class=\"loading-row\">Carregando sites cadastrados…</div></div>\n      </section>\n\n      <section class=\"management-view\" id=\"monitoringView\" hidden aria-labelledby=\"monitoringTitle\">\n        <div class=\"management-heading\">\n          <div><p class=\"eyebrow\">Acompanhamento exclusivo</p><h2 id=\"monitoringTitle\">Monitoramento dedicado</h2><p>Cadastre nomes, marcas ou assuntos. Essas notícias ficam isoladas nesta aba e nunca entram na Ronda principal.</p></div>\n          <span id=\"monitoringTermsLimit\">0/6 ativos</span>\n        </div>\n        <div class=\"background-note\"><strong>Busca automática contínua</strong><span>Enquanto o termo estiver ativo, o Cron buscará novas notícias mesmo sem navegador aberto.</span></div>\n        <form class=\"config-form config-form-terms\" id=\"monitoringTermForm\">\n          <label><span>Termo para acompanhar</span><input id=\"monitoringTermInput\" maxlength=\"80\" required placeholder=\"Ex.: Vini Jr\"></label>\n          <button class=\"primary\" type=\"submit\">Adicionar termo</button>\n        </form>\n        <p class=\"config-message\" id=\"monitoringTermMessage\"></p>\n        <div class=\"config-list compact-config-list\" id=\"monitoringTermsList\"><div class=\"loading-row\">Carregando termos…</div></div>\n        <div class=\"dedicated-heading\"><div><p class=\"eyebrow\">Última ronda automática</p><h3>Notícias dos termos ativos</h3></div><span id=\"dedicatedMonitoringMeta\">Nenhum resultado</span></div>\n        <div class=\"term-filters\" id=\"monitoringTermFilters\"></div>\n        <div class=\"dedicated-news-list\" id=\"dedicatedNewsList\"><div class=\"empty\"><strong>Nenhum termo monitorado</strong><span>Cadastre um termo para iniciar a busca dedicada.</span></div></div>\n      </section>\n\n      <div class=\"round-view\" id=\"roundView\">\n      <section class=\"summary\" aria-label=\"Resumo da ronda\">\n        <div><strong id=\"summaryContents\">0</strong><span>novos conteúdos</span><small>período selecionado</small></div>\n        <div><strong id=\"summaryTopics\">0</strong><span>assuntos ativos</span><small>janela atual</small></div>\n        <div><strong id=\"summaryChannels\">0</strong><span>fontes distintas</span><small>portais e redes</small></div>\n        <div class=\"attention\"><strong id=\"summaryUrgent\">0</strong><span>pautar agora</span><small>alta recorrência</small></div>\n      </section>\n\n      <section class=\"controls\" aria-label=\"Filtros da ronda\">\n        <label class=\"search\"><span>⌕</span><input id=\"searchInput\" placeholder=\"Buscar assunto, veículo ou canal\" aria-label=\"Buscar assunto, veículo ou canal\"></label>\n        <div class=\"segmented\" id=\"periodFilter\" aria-label=\"Período\">\n          <button data-value=\"5\" type=\"button\">5 min</button><button data-value=\"60\" type=\"button\">1h</button><button data-value=\"360\" type=\"button\">6h</button><button class=\"active\" data-value=\"1440\" type=\"button\">24h</button>\n        </div>\n        <div class=\"segmented\" id=\"sourceFilter\" aria-label=\"Tipo de fonte\">\n          <button class=\"active\" data-value=\"Todos\" type=\"button\">Todos</button><button data-value=\"Portal\" type=\"button\">Portais</button><button data-value=\"Rede\" type=\"button\">Redes</button>\n        </div>\n        <div class=\"segmented\" id=\"regionFilter\" aria-label=\"Região das fontes\">\n          <button class=\"active\" data-value=\"Todas\" type=\"button\">Todas regiões</button><button data-value=\"Brasil\" type=\"button\">Brasil</button><button data-value=\"Mundo\" type=\"button\">Mundo</button>\n        </div>\n      </section>\n\n      <section class=\"editoria-controls\" aria-label=\"Filtrar por editoria\">\n        <span>Editorias</span>\n        <div class=\"editoria-filter\" id=\"editoriaFilter\">\n          <button class=\"active\" data-editoria=\"Todas\" type=\"button\">Todas</button>\n          <button data-editoria=\"Notícias\" type=\"button\">Notícias</button>\n          <button data-editoria=\"Política\" type=\"button\">Política</button>\n          <button data-editoria=\"Esportes\" type=\"button\">Esportes</button>\n          <button data-editoria=\"Entretenimento\" type=\"button\">Entretenimento</button>\n          <button data-editoria=\"Fofoca e Celebridades\" type=\"button\">Fofoca e Celebridades</button>\n          <button data-editoria=\"Reality Shows\" type=\"button\">Reality Shows</button>\n          <button data-editoria=\"Curiosidades e Ciência Pop\" type=\"button\">Curiosidades e Ciência Pop</button>\n          <button data-editoria=\"Conteúdo Viral e Redes Sociais\" type=\"button\">Viral e Redes Sociais</button>\n          <button data-editoria=\"Luto e Obituário\" type=\"button\">Luto e Obituário</button>\n          <button data-editoria=\"Segurança e Justiça\" type=\"button\">Segurança e Justiça</button>\n          <button data-editoria=\"Economia\" type=\"button\">Economia</button>\n          <button data-editoria=\"Mundo\" type=\"button\">Mundo</button>\n          <button data-editoria=\"Tecnologia\" type=\"button\">Tecnologia</button>\n          <button data-editoria=\"Saúde\" type=\"button\">Saúde</button>\n        </div>\n      </section>\n\n      <div class=\"portal-filter\" id=\"portalFilter\" hidden><span>Exibindo somente:</span><strong id=\"portalFilterName\"></strong><button id=\"clearPortalFilter\" type=\"button\">Remover filtro ×</button></div>\n\n      <div class=\"heading\"><div><h2>Assuntos em destaque</h2><p>Ordenados por relevância editorial, recorrência e atualidade</p></div><span class=\"last-update\" id=\"lastUpdate\">Sem coleta</span></div>\n      <section class=\"grid\" id=\"topicsGrid\" aria-live=\"polite\"></section>\n      </div>\n    </section>\n  </main>\n\n  <div class=\"modal-backdrop\" id=\"settingsModal\" hidden>\n    <section class=\"modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"settingsTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Segurança</p><h2 id=\"settingsTitle\">Ajustes da operação</h2></div><button class=\"close-modal\" data-close=\"settingsModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <p class=\"modal-copy\">Se o Worker possuir a variável secreta <code>MANUAL_ROUND_TOKEN</code>, informe a mesma chave abaixo. Ela fica salva somente neste navegador.</p>\n      <label class=\"field\"><span>Chave para executar ronda manual</span><input id=\"operationToken\" type=\"password\" autocomplete=\"off\" placeholder=\"Opcional quando não há proteção\"></label>\n      <p class=\"field-message\" id=\"tokenMessage\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"settingsModal\" type=\"button\">Cancelar</button><button class=\"primary\" id=\"saveSettings\" type=\"button\">Salvar chave</button></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"historyModal\" hidden>\n    <section class=\"modal modal-wide\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"historyTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Últimas 48 horas</p><h2 id=\"historyTitle\">Histórico de rondas</h2></div><button class=\"close-modal\" data-close=\"historyModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <button class=\"history-back\" id=\"historyBack\" type=\"button\" hidden>← Voltar para todas as rondas</button>\n      <div class=\"history-list\" id=\"historyList\"><div class=\"loading-row\">Carregando histórico…</div></div>\n      <div class=\"history-detail\" id=\"historyDetail\" hidden></div>\n    </section>\n  </div>\n\n  <div class=\"modal-backdrop\" id=\"carouselModal\" hidden>\n    <section class=\"modal modal-wide carousel-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"carouselTitle\">\n      <div class=\"modal-head\"><div><p class=\"eyebrow\">Apoio editorial</p><h2 id=\"carouselTitle\">Roteiro para carrossel</h2></div><button class=\"close-modal\" data-close=\"carouselModal\" type=\"button\" aria-label=\"Fechar\">×</button></div>\n      <div class=\"carousel-loading\" id=\"carouselLoading\" hidden><span class=\"reader-spinner\">↻</span><div><strong>Abrindo uma matéria…</strong><small>Selecionando uma fonte, extraindo o texto e encerrando o ciclo após o roteiro.</small></div></div>\n      <div class=\"carousel-meta\" id=\"carouselMeta\"></div>\n      <section class=\"carousel-reading\" id=\"carouselReading\" hidden aria-label=\"Resumo da leitura inteligente\"></section>\n      <section class=\"carousel-evidence\" id=\"carouselEvidence\" hidden aria-label=\"Mapa de fatos e evidências\"></section>\n      <section class=\"carousel-analysis\" id=\"carouselAnalysis\" hidden aria-label=\"Interpretação da notícia\"></section>\n      <section class=\"carousel-entities\" id=\"carouselEntities\" hidden aria-label=\"Dados estruturados extraídos\"></section>\n      <div class=\"carousel-slides\" id=\"carouselSlides\"></div>\n      <section class=\"carousel-sources\" id=\"carouselSources\" aria-label=\"Links para apuração\"></section>\n      <p class=\"carousel-disclaimer\" id=\"carouselDisclaimer\"></p>\n      <div class=\"modal-actions\"><button class=\"secondary\" data-close=\"carouselModal\" type=\"button\">Fechar</button><button class=\"primary\" id=\"copyCarousel\" type=\"button\" disabled>Copiar roteiro</button></div>\n      <p class=\"copy-message\" id=\"copyCarouselMessage\"></p>\n    </section>\n  </div>\n\n  <script src=\"/app.js?v=2.4.3\" defer></script>\n</body>\n</html>\n"},"/styles.css":{"contentType":"text/css; charset=utf-8","body":":root{--ink:#17231e;--muted:#6e7b74;--line:#dfe7e2;--surface:#fff;--canvas:#f3f6f4;--green:#176b4b;--green-soft:#e9f4ee;--amber:#a85b15;--red:#b33b32}\n*{box-sizing:border-box}html{background:var(--canvas);scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-size:15px}button,input{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.app{min-height:100vh;display:grid;grid-template-columns:212px minmax(0,1fr)}\n.sidebar{position:sticky;top:0;height:100vh;padding:28px 18px 20px;background:#fbfdfc;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:42px}.brand{width:42px;height:42px;border:0;border-radius:12px;display:grid;place-items:center;background:var(--ink);color:#fff;font-size:13px;font-weight:800;letter-spacing:.06em;cursor:pointer}.sidebar nav{display:grid;gap:6px}.nav{width:100%;min-height:44px;padding:0 12px;border:0;border-radius:11px;display:grid;grid-template-columns:26px 1fr;align-items:center;gap:8px;background:transparent;color:#617068;cursor:pointer;text-align:left;font-weight:650}.nav:hover{background:#f0f4f2;color:var(--ink)}.nav.active{background:var(--green-soft);color:var(--green)}.nav-icon{font-size:11px;font-weight:850;width:22px;height:22px;border:1px solid currentColor;border-radius:7px;display:grid;place-items:center}.settings{margin-top:auto}\n.workspace{width:100%;max-width:1540px;margin:0 auto;padding:29px clamp(24px,3.1vw,54px) 70px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:32px}.eyebrow{margin:0 0 5px;color:var(--green);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.topbar h1{margin:0;font-size:clamp(27px,2.5vw,38px);line-height:1.08;letter-spacing:-.04em}.topbar h1 span{color:var(--muted);font-weight:500}.top-actions{display:flex;align-items:center;gap:10px}.icon-button{width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:#fff;color:#617068;cursor:pointer}.icon-button:hover{color:var(--green);border-color:#bad0c5}.run-round{height:46px;padding:0 17px;border:0;border-radius:12px;background:var(--green);color:#fff;display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:800;box-shadow:0 5px 14px rgba(23,107,75,.18)}.run-round:hover{background:#105b3e}.run-round:disabled{opacity:.65;cursor:wait}.run-round.loading span{animation:spin .8s linear infinite}.status{display:flex;align-items:center;gap:11px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:12px}.status div{display:flex;flex-direction:column;gap:2px}.status strong{font-size:12px}.status small{color:var(--muted);font-size:11px}.live{width:9px;height:9px;border-radius:50%;background:#9aa69f;box-shadow:0 0 0 4px #edf1ef}.live.ok{background:#1b9b61;box-shadow:0 0 0 4px #dff4e9}.live.error{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.live.warn{background:#d47c25;box-shadow:0 0 0 4px #fff1df}\n.notice{margin-top:23px;padding:10px 13px;background:#edf7f1;border:1px solid #d4e9dc;border-radius:10px;color:#52675c;font-size:12px}.notice>span{margin-right:8px;padding:3px 7px;background:#d9eee1;border-radius:5px;color:#245f45;font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:9px}.notice strong{font-weight:750}.source-health{margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:25px;scroll-margin-top:20px}.health-label{margin-right:3px;color:var(--muted);font-size:10px;font-weight:750}.health-chip{padding:5px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#66736c;font-size:9px;font-weight:750}.health-chip.ok{border-color:#cfe4d7;background:#f0f8f3;color:#256548}.health-chip.error{border-color:#f0d3cf;background:#fff5f3;color:#9a3c34}.health-message{padding:8px 10px;border-radius:8px;background:#fff5f3;color:#9a3c34;font-size:11px}.health-message.warn{background:#fff7ec;color:#925315}\n.summary{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:16px;display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden}.summary>div{min-height:90px;padding:19px 22px;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:12px;align-content:center;border-right:1px solid var(--line)}.summary>div:last-child{border-right:0}.summary strong{grid-row:1/3;align-self:center;font-size:30px;letter-spacing:-.05em}.summary span{align-self:end;font-weight:720;font-size:13px}.summary small{color:var(--muted);font-size:11px}.summary .attention{background:#fffbf8}.summary .attention strong{color:var(--red)}\n.controls{margin:18px 0 28px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.search{height:42px;min-width:300px;flex:1 1 360px;display:flex;align-items:center;gap:9px;padding:0 13px;background:#fff;border:1px solid var(--line);border-radius:11px;color:var(--muted)}.search:focus-within{border-color:#93b7a6;box-shadow:0 0 0 3px #dfeee7}.search input{width:100%;border:0;outline:0;background:transparent;color:var(--ink);font-size:13px}.segmented{display:inline-flex;padding:3px;background:#e8eeeb;border-radius:10px}.segmented button{height:34px;padding:0 11px;border:0;border-radius:8px;background:transparent;color:#6c7771;cursor:pointer;font-size:11px;font-weight:750}.segmented button.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px #53685a25}.heading{margin-bottom:14px;display:flex;align-items:end;justify-content:space-between;gap:20px}.heading h2{margin:0;font-size:18px;letter-spacing:-.02em}.heading p{margin:4px 0 0;color:var(--muted);font-size:12px}.last-update{color:var(--muted);font-size:11px;font-weight:650}\n.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 5px 18px rgba(23,35,30,.035)}.accent{position:absolute;inset:0 auto 0 0;width:4px;background:#b9c5bf}.card.urgent .accent{background:var(--red)}.card.watch .accent{background:var(--amber)}.card-body{padding:20px 21px 18px 23px}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px}.priority{display:inline-flex;align-items:center;gap:7px;color:#6b7771;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.065em}.priority i{width:6px;height:6px;border-radius:50%;background:#8d9993}.urgent .priority{color:var(--red)}.urgent .priority i{background:var(--red);box-shadow:0 0 0 4px #fff0ee}.watch .priority{color:var(--amber)}.watch .priority i{background:var(--amber)}.score{padding:5px 8px;background:#f0f4f2;border-radius:7px;color:#627069;font-size:10px;font-weight:800}.card h2{min-height:52px;margin:12px 0 11px;font-size:19px;line-height:1.35;letter-spacing:-.025em}.card-sources{margin:11px 0 2px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.card-sources>span:first-child{margin-right:2px;color:var(--muted);font-size:9px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.source-badge{padding:4px 7px;border-radius:999px;background:#edf3f0;color:#40574c;font-size:9px;font-weight:750}.published{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:10px;flex-wrap:wrap}.published strong{color:#4b5952;font-size:11px}.relative{padding-left:7px;border-left:1px solid var(--line);color:var(--green);font-weight:750}.momentum{margin-top:12px;display:flex;align-items:center;gap:7px;color:var(--green);font-size:11px;font-weight:750}.trend{width:19px;height:19px;display:grid;place-items:center;background:var(--green-soft);border-radius:6px}.calculated{margin-left:auto;color:#919b96;font-size:9px;font-weight:600}.recommendation{margin-top:12px;padding:10px 11px;border-radius:9px;background:#f5f7f6;color:#55635c;font-size:10px;line-height:1.45}.recommendation strong{color:var(--ink)}\n.primary-source,.source{margin-top:13px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fbfcfb}.kicker{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:9px;flex-wrap:wrap}.kicker strong{color:#48564f}.kind{padding:3px 5px;border-radius:4px;background:#edf1ef;color:#5f6c65;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.kind.bluesky{background:#edf5ff;color:#26669c}.primary-source h3,.source h3{min-height:33px;margin:7px 0 9px;font-size:12px;line-height:1.38}.source-footer{display:flex;align-items:end;justify-content:flex-end;gap:12px}.source-metrics{display:flex;gap:13px;color:var(--muted);font-size:9px;flex-wrap:wrap}.source-metrics strong{color:#4a5851}.open{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:8px 10px;border:1px solid #b9cec3;border-radius:8px;color:var(--green);text-decoration:none;font-size:9px;font-weight:800;white-space:nowrap}.open:hover{background:var(--green);border-color:var(--green);color:#fff}.toggle{width:100%;margin-top:14px;padding:12px 0 0;border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;background:#fff;color:var(--ink);cursor:pointer;font-size:11px;font-weight:780}.source-list{display:grid;gap:8px}.source{display:flex;align-items:center;gap:13px}.source>div{min-width:0;flex:1}.source h3{min-height:auto}.empty{grid-column:1/-1;min-height:220px;border:1px dashed #cbd6d0;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px;text-align:center;color:var(--muted)}.empty strong{color:var(--ink)}\n.modal-backdrop{position:fixed;z-index:100;inset:0;padding:24px;background:rgba(16,29,23,.42);display:grid;place-items:center}.modal-backdrop[hidden]{display:none}.modal{width:min(520px,100%);max-height:min(760px,calc(100vh - 48px));overflow:auto;padding:24px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 70px rgba(12,26,19,.22)}.modal-wide{width:min(820px,100%)}.modal-head{display:flex;align-items:start;justify-content:space-between;gap:20px}.modal h2{margin:0;font-size:21px}.close-modal{width:36px;height:36px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--muted);cursor:pointer;font-size:22px}.modal-copy{margin:17px 0;color:var(--muted);font-size:12px;line-height:1.55}.modal-copy code{padding:2px 5px;border-radius:5px;background:#eef2f0;color:var(--ink)}.field{display:grid;gap:7px}.field span{font-size:11px;font-weight:750}.field input{height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;outline:0}.field input:focus{border-color:#83ad99;box-shadow:0 0 0 3px #e1efe8}.field-message{min-height:18px;margin:7px 0 0;color:var(--red);font-size:10px}.modal-actions{margin-top:17px;display:flex;justify-content:flex-end;gap:8px}.primary,.secondary{height:40px;padding:0 14px;border-radius:10px;cursor:pointer;font-size:11px;font-weight:800}.primary{border:0;background:var(--green);color:#fff}.secondary{border:1px solid var(--line);background:#fff;color:var(--ink)}.history-list{margin-top:18px;display:grid;border:1px solid var(--line);border-radius:12px;overflow:hidden}.history-row{min-height:55px;padding:10px 12px;display:grid;grid-template-columns:1.3fr .8fr repeat(3,.55fr);align-items:center;gap:10px;border-bottom:1px solid var(--line);font-size:11px}.history-row:last-child{border:0}.history-row strong{font-size:11px}.history-row span{color:var(--muted)}.history-status{justify-self:start;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800}.history-status.success{background:#e9f5ee;color:#226647}.history-status.failed{background:#fff0ee;color:#9b3e36}.loading-row{padding:30px;text-align:center;color:var(--muted);font-size:12px}\n@media(max-width:1180px){.app{grid-template-columns:76px minmax(0,1fr)}.sidebar{padding:24px 12px;align-items:center}.nav{grid-template-columns:1fr;width:44px;padding:0;place-items:center}.nav span:nth-child(2){display:none}}\n@media(max-width:900px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.summary>div:nth-child(2){border-right:0}.summary>div:nth-child(-n+2){border-bottom:1px solid var(--line)}.topbar{align-items:stretch;flex-direction:column}.top-actions{align-items:stretch}.run-round{flex:1;justify-content:center}.history-row{grid-template-columns:1.2fr .8fr repeat(2,.5fr)}.history-row span:last-child{display:none}}\n@media(max-width:700px){.app{display:block}.sidebar{z-index:10;width:100%;height:64px;padding:8px 12px;position:fixed;inset:auto 0 0;border:1px solid var(--line);flex-direction:row;justify-content:center;gap:10px}.brand,.settings{display:none}.sidebar nav{width:100%;display:flex;justify-content:space-around}.nav{width:52px;min-height:46px}.workspace{padding:22px 15px 94px}.icon-button{display:none}.status{padding:9px 12px}.summary>div{min-height:76px;padding:14px}.summary strong{font-size:24px}.search{min-width:100%}.heading p{display:none}.card-body{padding:18px 16px 16px 19px}.card h2{min-height:auto;font-size:18px}.source,.source-footer{align-items:stretch;flex-direction:column}.open{width:100%;justify-content:center}.calculated{display:none}.modal-backdrop{padding:12px}.modal{max-height:calc(100vh - 24px);padding:19px}.history-row{grid-template-columns:1.2fr .8fr .55fr}.history-row span:nth-last-child(-n+2){display:none}}\n.health-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer}.health-chip:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(23,35,30,.08)}.health-chip.selected{border-color:var(--green);background:var(--green);color:#fff;box-shadow:0 0 0 3px rgba(23,107,75,.14)}.health-chip.selected .health-icon{background:#fff;color:var(--green)}.health-icon{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#fff;border:1px solid currentColor;font-size:7px}\n.sources-view{margin-top:24px}.sources-view[hidden],.round-view[hidden]{display:none}.sources-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:15px}.sources-heading h2{margin:0;font-size:25px;letter-spacing:-.035em}.sources-heading p:not(.eyebrow){margin:6px 0 0;color:var(--muted);font-size:12px}.source-portal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.portal-card{min-height:92px;padding:15px;border:1px solid var(--line);border-radius:14px;background:#fff;display:grid;grid-template-columns:46px 1fr auto;align-items:center;gap:13px;text-align:left;color:var(--ink);cursor:pointer;box-shadow:0 4px 14px rgba(23,35,30,.025)}.portal-card:hover,.portal-card.selected{border-color:#8db6a2;box-shadow:0 6px 18px rgba(23,107,75,.1);transform:translateY(-1px)}.portal-card.error{background:#fffafa}.portal-icon{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:var(--green-soft);color:var(--green);font-size:11px;font-weight:850;letter-spacing:.04em}.portal-card.error .portal-icon{background:#fff0ee;color:var(--red)}.portal-card-copy{min-width:0;display:flex;flex-direction:column;gap:5px}.portal-card-copy strong{font-size:13px}.portal-card-copy small{color:var(--muted);font-size:10px}.portal-state{color:var(--green);font-size:10px;font-weight:800}.portal-card.error .portal-state{color:var(--red)}.sources-empty{min-height:180px}\n.portal-filter{margin:-13px 0 19px;padding:10px 12px;border:1px solid #cfe4d7;border-radius:10px;background:#edf7f1;display:flex;align-items:center;gap:7px;color:#52675c;font-size:11px}.portal-filter[hidden]{display:none}.portal-filter strong{color:var(--green)}.portal-filter button{margin-left:auto;padding:5px 8px;border:0;border-radius:7px;background:#fff;color:var(--green);cursor:pointer;font-size:9px;font-weight:800}\n.source-badge{border:0}.source-badge[data-portal]{cursor:pointer}.source-badge[data-portal]:hover{background:#dcebe3;color:var(--green)}.source-name-button{padding:0;border:0;background:transparent;color:#48564f;cursor:pointer;font-size:9px;font-weight:750}.source-name-button:hover{color:var(--green);text-decoration:underline}.history-status.running{background:#fff4e7;color:#9a591a}\n@media(max-width:900px){.source-portal-grid{grid-template-columns:1fr}}\n@media(max-width:700px){.sources-heading{align-items:stretch;flex-direction:column}.portal-card{grid-template-columns:42px 1fr}.portal-icon{width:42px;height:42px}.portal-state{display:none}}\n.modal-wide{width:min(1080px,100%)}.history-row{width:100%;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;cursor:pointer}.history-row:hover{background:#f7faf8}.history-row:focus-visible{position:relative;z-index:1;outline:3px solid #b9d9c8;outline-offset:-3px}.history-row:disabled{cursor:wait;opacity:.72}.history-date{display:flex;flex-direction:column;gap:2px}.history-date small,.history-open small{color:var(--muted);font-size:10px}.history-open{display:flex;flex-direction:column;gap:3px}.history-open strong{color:var(--muted);font-weight:500}.history-open small{color:var(--green);font-weight:800}.history-back{margin:16px 0 0;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--green);cursor:pointer;font-size:10px;font-weight:800}.history-back[hidden],.history-detail[hidden],.history-list[hidden]{display:none}.history-detail{margin-top:16px}.history-detail-head{padding:16px 17px;border:1px solid var(--line);border-radius:13px;background:#f7faf8}.history-detail-head h3{margin:0;font-size:19px}.history-detail-head p:last-child{margin:5px 0 0;color:var(--muted);font-size:11px}.history-source-chips{margin:12px 0;display:flex;gap:6px;flex-wrap:wrap}.history-source-chips span{padding:6px 8px;border:1px solid #cfe4d7;border-radius:999px;background:#f0f8f3;color:#256548;font-size:9px;font-weight:750}.history-news-list{display:grid;gap:9px}.history-news{padding:14px 15px;border:1px solid var(--line);border-radius:12px;background:#fff}.history-news-meta{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:9px;flex-wrap:wrap}.history-news-meta strong{color:#48564f}.history-news-meta time{margin-left:auto}.history-news h3{margin:8px 0 5px;font-size:13px;line-height:1.4}.history-news p{margin:0 0 9px;color:var(--muted);font-size:10px;line-height:1.45}.history-news a{color:var(--green);font-size:9px;font-weight:800;text-decoration:none}.history-news a:hover{text-decoration:underline}.history-empty{min-height:180px}\n@media(max-width:900px){.history-row{grid-template-columns:1.2fr .8fr .6fr .6fr .7fr}.history-row .history-open{display:flex!important}}\n@media(max-width:700px){.history-row{grid-template-columns:1.2fr .8fr .7fr}.history-row>span:nth-child(3),.history-row>span:nth-child(4){display:none}.history-row .history-open{display:flex!important}.history-open strong{display:none}.history-news-meta time{width:100%;margin-left:0}}\n.editoria-controls{margin:-13px 0 27px;display:flex;align-items:center;gap:9px}.editoria-controls>span{flex:0 0 auto;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.editoria-filter{display:flex;gap:5px;flex-wrap:wrap}.editoria-filter button{height:30px;padding:0 10px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#617068;cursor:pointer;font-size:9px;font-weight:800}.editoria-filter button:hover{border-color:#9ebcac;color:var(--green)}.editoria-filter button.active{border-color:var(--green);background:var(--green);color:#fff}.topic-labels{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.editoria-badge{padding:4px 7px;border-radius:999px;background:#e8efff;color:#3158a6;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.045em}\n@media(max-width:700px){.editoria-controls{align-items:flex-start;flex-direction:column}.editoria-filter{width:100%;flex-wrap:nowrap;overflow-x:auto;padding:0 0 5px;scrollbar-width:thin}.editoria-filter button{flex:0 0 auto}}\n.carousel-teaser{margin-top:12px;padding:10px 11px;border:1px solid #d9e2f6;border-radius:10px;background:#f7f9ff;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 180px;align-items:center;gap:10px}.carousel-teaser>div{min-width:0;display:flex;flex-direction:column;gap:3px}.carousel-teaser span{color:#788398;font-size:8px;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.carousel-teaser strong{color:#33496f;font-size:10px;line-height:1.25;overflow-wrap:anywhere}.carousel-teaser button{width:100%;min-width:0;height:44px;padding:0 16px;border:0;border-radius:10px;background:#4565b7;color:#fff;cursor:pointer;font-size:11px;font-weight:850;line-height:1.2;box-shadow:0 5px 14px rgba(69,101,183,.22)}.carousel-teaser button:hover{background:#36549e;transform:translateY(-1px);box-shadow:0 7px 18px rgba(54,84,158,.26)}.carousel-teaser button:focus-visible{outline:3px solid rgba(69,101,183,.25);outline-offset:2px}.carousel-modal{width:min(1180px,100%)}.carousel-meta{margin:16px 0 13px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.carousel-meta>span{padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#f8faf9;display:flex;flex-direction:column;gap:3px}.carousel-meta small{color:var(--muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.carousel-meta strong{font-size:11px}.carousel-slides{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.carousel-slide{min-height:240px;padding:14px;border:1px solid #dbe3f5;border-radius:14px;background:linear-gradient(160deg,#fff 0%,#f2f5ff 100%);display:flex;flex-direction:column}.carousel-slide>div{display:flex;align-items:center;gap:7px}.carousel-slide>div>span{width:25px;height:25px;border-radius:8px;display:grid;place-items:center;background:#4565b7;color:#fff;font-size:10px;font-weight:850}.carousel-slide small{color:#6b7891;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.carousel-slide h3{margin:17px 0 9px;font-size:14px;line-height:1.25}.carousel-slide p{margin:0;color:#526075;font-size:10px;line-height:1.48}.carousel-disclaimer{margin:13px 0 0;padding:9px 11px;border-radius:9px;background:#fff7e9;color:#805b25;font-size:9px;line-height:1.45}.copy-message{min-height:16px;margin:6px 0 0;text-align:right;color:var(--green);font-size:9px;font-weight:750}\n.carousel-sources{margin-top:14px;padding:14px;border:1px solid #cfe4d7;border-radius:13px;background:#f7fbf9}.carousel-sources-head{display:flex;align-items:end;justify-content:space-between;gap:14px}.carousel-sources-head h3{margin:0;font-size:15px}.carousel-sources-head>span{color:var(--muted);font-size:9px;font-weight:750}.carousel-source-list{margin-top:10px;display:grid;gap:7px}.carousel-source-link{padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;color:var(--ink);text-decoration:none}.carousel-source-link:hover{border-color:#98bba9;box-shadow:0 3px 10px rgba(23,107,75,.08)}.carousel-source-link>span{min-width:0;display:flex;flex-direction:column;gap:4px}.carousel-source-link strong{font-size:10px;line-height:1.35}.carousel-source-link small{color:var(--muted);font-size:9px}.carousel-source-link em{flex:0 0 auto;color:var(--green);font-size:9px;font-style:normal;font-weight:800}\n@media(max-width:900px){.carousel-slides{grid-template-columns:repeat(2,minmax(0,1fr))}.carousel-slide:last-child{grid-column:1/-1}.carousel-teaser{grid-template-columns:1fr 1fr}.carousel-teaser button{grid-column:1/-1;width:100%;min-width:0}}\n@media(max-width:700px){.carousel-meta{grid-template-columns:1fr}.carousel-slides{grid-template-columns:1fr}.carousel-slide,.carousel-slide:last-child{min-height:200px;grid-column:auto}.carousel-teaser{grid-template-columns:1fr}.carousel-source-link{align-items:stretch;flex-direction:column;gap:8px}.carousel-source-link em{align-self:flex-start}}\n@keyframes spin{to{transform:rotate(360deg)}}\n.source-portal-grid{grid-template-columns:1fr;gap:22px}.source-region-group{display:grid;gap:10px}.source-region-heading{display:flex;align-items:end;justify-content:space-between;gap:12px}.source-region-heading h3{margin:0;font-size:16px}.source-region-heading span{color:var(--muted);font-size:10px}.source-region-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.portal-card:disabled{cursor:not-allowed;opacity:.72}.portal-card:disabled:hover{transform:none;box-shadow:0 4px 14px rgba(23,35,30,.025)}.health-region{margin-left:5px;padding:3px 6px;border-radius:999px;background:#e8eeeb;color:#52625a;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.health-chip:disabled{cursor:not-allowed;opacity:.7}.health-chip:disabled:hover{transform:none;box-shadow:none}\n@media(max-width:900px){.source-region-grid{grid-template-columns:1fr}}\n\n\n/* Leitura Inteligente de Notícias — v2.4.3 */\n.carousel-teaser{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 245px}.carousel-teaser button{min-height:50px;height:auto;padding:10px 18px;font-size:11px}.carousel-meta{grid-template-columns:repeat(5,minmax(0,1fr))}.carousel-loading{margin:16px 0;padding:15px 16px;border:1px solid #cfdcf6;border-radius:13px;background:#f4f7ff;display:flex;align-items:center;gap:12px}.carousel-loading[hidden]{display:none}.carousel-loading.error{border-color:#f0c9c4;background:#fff5f3}.reader-spinner,.reader-error{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:grid;place-items:center;background:#4565b7;color:#fff;font-size:16px;font-weight:900}.reader-spinner{animation:spin .8s linear infinite}.reader-error{background:var(--red)}.carousel-loading div{display:flex;flex-direction:column;gap:3px}.carousel-loading strong{font-size:12px}.carousel-loading small{color:var(--muted);font-size:10px;line-height:1.4}.carousel-reading,.carousel-analysis,.carousel-entities{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:13px;background:#fbfcfb}.carousel-reading[hidden],.carousel-analysis[hidden],.carousel-entities[hidden]{display:none}.carousel-section-head{display:flex;align-items:end;justify-content:space-between;gap:14px}.carousel-section-head h3{margin:0;font-size:15px}.carousel-section-head>span{padding:5px 8px;border-radius:999px;background:#eaf4ee;color:var(--green);font-size:9px;font-weight:800}.reading-stats{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.reading-stats>span{padding:10px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;flex-direction:column;gap:4px}.reading-stats small,.entity-grid small{color:var(--muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.reading-stats strong{font-size:11px}.question-grid{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.question-grid article{padding:11px;border:1px solid #dbe3f5;border-radius:11px;background:#fff}.question-grid small{color:#4565b7;font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.question-grid p{margin:7px 0 0;color:#526075;font-size:10px;line-height:1.48}.entity-grid{margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.entity-grid>div{min-width:0}.entity-chips{margin-top:6px;display:flex;gap:5px;flex-wrap:wrap}.entity-chips span{max-width:100%;padding:5px 7px;border-radius:999px;background:#edf3f0;color:#40574c;font-size:9px;font-weight:750;overflow-wrap:anywhere}.entity-chips em{color:var(--muted);font-size:9px;font-style:normal}.carousel-slides{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.carousel-slide{min-height:225px}.carousel-source-link .read-status{font-weight:750}.carousel-source-link.read-ok .read-status{color:var(--green)}.carousel-source-link.read-error .read-status{color:var(--red)}.modal-actions .primary:disabled{opacity:.55;cursor:not-allowed}\n@media(max-width:1000px){.carousel-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.question-grid,.entity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:900px){.carousel-teaser{grid-template-columns:1fr 1fr}.carousel-teaser button{grid-column:1/-1}.reading-stats{grid-template-columns:1fr 1fr}.reading-stats>span:last-child{grid-column:1/-1}}\n@media(max-width:700px){.carousel-meta,.question-grid,.entity-grid,.reading-stats{grid-template-columns:1fr}.reading-stats>span:last-child{grid-column:auto}.carousel-section-head{align-items:flex-start;flex-direction:column}.carousel-teaser{grid-template-columns:1fr}.carousel-teaser button{grid-column:auto}.carousel-slide{min-height:190px}}\n\n.carousel-disclaimer:empty{display:none}\n.carousel-evidence{margin:14px 0;padding:14px;border:1px solid #cfdcf6;border-radius:13px;background:#f7f9ff}.carousel-evidence[hidden]{display:none}.evidence-list{margin-top:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.evidence-list article{padding:11px;border:1px solid #dbe3f5;border-radius:11px;background:#fff}.evidence-list article>div{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.evidence-list strong{font-size:10px;line-height:1.4}.evidence-list small{flex:0 0 auto;padding:3px 6px;border-radius:999px;background:#eaf4ee;color:var(--green);font-size:8px;font-weight:800}.evidence-list p{margin:7px 0 0;color:#5c687d;font-size:9px;line-height:1.5}.carousel-slide [contenteditable=true]{border-radius:6px;outline:none}.carousel-slide [contenteditable=true]:focus{box-shadow:0 0 0 3px rgba(69,101,183,.14);background:#fff}.carousel-slide footer{margin-top:auto;padding-top:12px;display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:8px;font-weight:750}.carousel-slide.over-limit{border-color:#d77d72;background:#fff5f3}.carousel-slide.over-limit footer{color:var(--red)}.reading-stats .cycle-release{grid-column:span 2;background:#eef8f2;border-color:#bcdcc9}.reading-stats .cycle-release strong{color:var(--green)}\n@media(max-width:700px){.evidence-list{grid-template-columns:1fr}.reading-stats .cycle-release{grid-column:auto}}\n.management-view{margin:22px 0 30px}.management-view[hidden]{display:none}.management-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.management-heading h2{margin:0;font-size:25px}.management-heading p:last-child{max-width:760px;margin:7px 0 0;color:var(--muted);font-size:11px;line-height:1.55}.management-heading>span{flex:0 0 auto;padding:7px 10px;border-radius:999px;background:var(--green-soft);color:var(--green);font-size:9px;font-weight:850}.background-note{margin-top:14px;padding:12px 14px;border:1px solid #cfe4d7;border-radius:12px;background:#f3faf6;display:flex;align-items:center;gap:10px}.background-note strong{font-size:10px;color:var(--green)}.background-note span{color:var(--muted);font-size:10px;line-height:1.45}.config-form{margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:13px;background:#fff;display:grid;align-items:end;gap:10px}.config-form-sites{grid-template-columns:1fr 2fr 150px auto}.config-form-terms{grid-template-columns:minmax(220px,1fr) auto}.config-form label{display:grid;gap:6px}.config-form label>span{color:#53625b;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.config-form input,.config-form select{width:100%;height:42px;padding:0 11px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);outline:0;font:inherit;font-size:11px}.config-form input:focus,.config-form select:focus{border-color:#83ad99;box-shadow:0 0 0 3px #e1efe8}.config-form .primary{height:42px}.config-message{min-height:18px;margin:7px 2px 0;color:var(--green);font-size:10px;font-weight:700}.config-list{margin-top:8px;display:grid;gap:8px}.compact-config-list{margin-bottom:24px}.config-row{padding:12px 13px;border:1px solid var(--line);border-radius:11px;background:#fff;display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;gap:12px}.config-row.inactive{background:#f7f8f7;opacity:.78}.config-status{padding:5px 7px;border-radius:999px;background:#e9f5ee;color:var(--green);font-size:8px;font-weight:850;text-align:center}.config-row.inactive .config-status{background:#ecefed;color:#707b75}.config-main{min-width:0;display:flex;flex-direction:column;gap:3px}.config-main strong{font-size:12px}.config-main a{overflow:hidden;color:var(--green);font-size:9px;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}.config-main small{color:var(--muted);font-size:9px}.config-actions{display:flex;gap:6px}.config-actions .secondary,.danger-button{height:34px;padding:0 10px;border-radius:8px;font-size:9px;font-weight:800;cursor:pointer}.danger-button{border:1px solid #ecc9c4;background:#fff7f5;color:var(--red)}.config-empty{min-height:150px}.dedicated-heading{margin-top:8px;padding-top:20px;border-top:1px solid var(--line);display:flex;align-items:flex-end;justify-content:space-between;gap:15px}.dedicated-heading h3{margin:0;font-size:18px}.dedicated-heading>span{color:var(--muted);font-size:9px;font-weight:750}.term-filters{margin:11px 0;display:flex;gap:6px;flex-wrap:wrap}.term-filters button{padding:7px 9px;border:1px solid var(--line);border-radius:999px;background:#fff;color:#5c6862;font-size:9px;font-weight:800;cursor:pointer}.term-filters button.active{border-color:#9cc4af;background:var(--green-soft);color:var(--green)}.dedicated-news-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.dedicated-news{padding:14px;border:1px solid #d7e3dc;border-radius:12px;background:#fff}.dedicated-news-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:9px}.dedicated-news-meta strong{color:#52625a}.dedicated-tags{margin-top:8px;display:flex;gap:5px;flex-wrap:wrap}.dedicated-tags span{padding:4px 6px;border-radius:999px;background:#edf3ff;color:#4565b7;font-size:8px;font-weight:850}.dedicated-news h3{margin:9px 0 6px;font-size:13px;line-height:1.4}.dedicated-news p{margin:0 0 9px;color:var(--muted);font-size:10px;line-height:1.5}.dedicated-news a{color:var(--green);font-size:9px;font-weight:850;text-decoration:none}\n@media(max-width:920px){.config-form-sites{grid-template-columns:1fr 1fr}.config-form-sites label:nth-child(2){grid-column:span 1}.config-form-sites .primary{width:100%}.dedicated-news-list{grid-template-columns:1fr}}\n@media(max-width:700px){.management-heading,.dedicated-heading,.background-note{align-items:flex-start;flex-direction:column}.config-form-sites,.config-form-terms{grid-template-columns:1fr}.config-form-sites label:nth-child(2){grid-column:auto}.config-row{grid-template-columns:1fr}.config-status{justify-self:start}.config-actions{width:100%}.config-actions button{flex:1}.dedicated-news-list{grid-template-columns:1fr}}\n\n/* Leitura inteligente assíncrona v2.1 */\n.carousel-loading .reader-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}\n.carousel-loading .reader-progress{width:100%;height:6px;display:block;overflow:hidden;border-radius:999px;background:#dfe7f7}\n.carousel-loading .reader-progress i{height:100%;display:block;border-radius:inherit;background:#4565b7;transition:width .25s ease}\n.carousel-loading .reader-copy>em{align-self:flex-end;color:#647089;font-size:9px;font-style:normal;font-weight:850}\n.reader-retry{align-self:flex-start;margin-top:5px;padding:7px 11px;border:0;border-radius:8px;background:var(--red);color:#fff;font:inherit;font-size:10px;font-weight:850;cursor:pointer}\n.reading-stats{grid-template-columns:repeat(4,minmax(0,1fr))}\n.carousel-source-link.read-fallback .read-status{color:#9a6900}\n@media(max-width:820px){.reading-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}\n.health-chip.ok.cache{border-color:#ead7a8;background:#fff8e8;color:#8a6518}.portal-card.ok.cache{border-color:#ead7a8;background:#fffdf6}.portal-card.ok.cache .portal-icon{background:#fff3cf;color:#8a6518}.portal-card.ok.cache .portal-state{color:#8a6518}\n"},"/app.js":{"contentType":"text/javascript; charset=utf-8","body":"const STORAGE_TOKEN = \"ronda-editorial-operation-token-v1\";\nconst state = {\n  data: null,\n  health: null,\n  query: \"\",\n  period: 1440,\n  source: \"Todos\",\n  region: \"Todas\",\n  editoria: \"Todas\",\n  portal: null,\n  view: \"round\",\n  expanded: new Set(),\n  running: false,\n  lastRunId: null,\n  carouselText: \"\",\n  activeCarousel: null,\n  smartCarousels: new Map(),\n  activeTopicId: null,\n  carouselLoading: false,\n  carouselRequestSerial: 0,\n  customSources: [],\n  customSourcesLimit: 8,\n  monitoringTerms: [],\n  monitoringTermsLimit: 6,\n  monitoringTermFilter: \"all\",\n};\n\nconst numberFormat = new Intl.NumberFormat(\"pt-BR\", { notation: \"compact\", maximumFractionDigits: 1 });\nconst dateFormat = new Intl.DateTimeFormat(\"pt-BR\", { day: \"2-digit\", month: \"2-digit\", year: \"numeric\", hour: \"2-digit\", minute: \"2-digit\" });\nconst runButton = document.getElementById(\"runRound\");\nconst grid = document.getElementById(\"topicsGrid\");\nconst liveDot = document.getElementById(\"liveDot\");\nconst statusLabel = document.getElementById(\"statusLabel\");\nconst statusSub = document.getElementById(\"statusSub\");\nconst roundView = document.getElementById(\"roundView\");\nconst sourcesView = document.getElementById(\"sourcesView\");\nconst customSourcesView = document.getElementById(\"customSourcesView\");\nconst monitoringView = document.getElementById(\"monitoringView\");\n\nfunction escapeHtml(value) {\n  return String(value ?? \"\").replace(/[&<>'\"]/g, (character) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", \"'\": \"&#39;\", '\"': \"&quot;\" })[character]);\n}\n\nfunction safeUrl(value) {\n  try {\n    const url = new URL(String(value));\n    return /^https?:$/.test(url.protocol) ? url.toString() : \"#\";\n  } catch {\n    return \"#\";\n  }\n}\n\nfunction formatDate(value) {\n  const date = new Date(value);\n  return Number.isFinite(date.getTime()) ? dateFormat.format(date).replace(\",\", \"\") : \"Data não informada\";\n}\n\nfunction relativeTime(value) {\n  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));\n  if (minutes < 1) return \"agora\";\n  if (minutes < 60) return `há ${minutes} min`;\n  const hours = Math.floor(minutes / 60);\n  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;\n}\n\nfunction setStatus(type, label, sub) {\n  liveDot.className = `live ${type || \"\"}`;\n  statusLabel.textContent = label;\n  statusSub.textContent = sub;\n}\n\nasync function api(path, options = {}) {\n  const response = await fetch(path, { cache: \"no-store\", ...options });\n  const payload = response.status === 204 ? null : await response.json().catch(() => null);\n  if (!response.ok) {\n    const parts = [payload?.error, payload?.detail].filter((value, index, list) => value && list.indexOf(value) === index);\n    const error = new Error(parts.join(\" — \") || `Falha HTTP ${response.status}`);\n    error.status = response.status;\n    error.payload = payload;\n    throw error;\n  }\n  return payload;\n}\n\nfunction itemMatchesSource(item) {\n  const matchesType = state.source === \"Todos\" || (state.source === \"Portal\" ? item.kind === \"portal\" : item.kind === \"social\");\n  const matchesPortal = !state.portal || item.collectorName === state.portal || item.sourceName === state.portal;\n  const matchesRegion = state.region === \"Todas\" || item.region === state.region;\n  return matchesType && matchesPortal && matchesRegion;\n}\n\nfunction itemWithinPeriod(item) {\n  const age = (Date.now() - Date.parse(item.publishedAt)) / 60_000;\n  return Number.isFinite(age) && age >= -5 && age <= state.period;\n}\n\nfunction sourceMarkup(item, primary = false) {\n  const platform = item.platform || (item.kind === \"portal\" ? \"Portal\" : \"Rede\");\n  return `<div class=\"${primary ? \"primary-source\" : \"source\"}\"><div><div class=\"kicker\"><span class=\"kind ${escapeHtml(platform.toLowerCase())}\">${escapeHtml(platform)}</span><button class=\"source-name-button\" data-portal=\"${escapeHtml(item.collectorName || item.sourceName)}\" type=\"button\" title=\"Mostrar somente esta fonte\">${escapeHtml(item.sourceName)}</button><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class=\"source-footer\"><a class=\"open\" href=\"${escapeHtml(safeUrl(item.url))}\" target=\"_blank\" rel=\"noreferrer\">Abrir para apuração ↗</a></div></div></div>`;\n}\n\nfunction sourceInitials(name) {\n  return String(name || \"?\").split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join(\"\").toUpperCase();\n}\n\nfunction sourceRegion(source) {\n  return source?.region || (source?.name === \"Bluesky\" ? \"Rede\" : \"Brasil\");\n}\n\nfunction sourceRouteLabel(source, compact = false) {\n  if (source?.cached || source?.route === \"cache\") return compact ? \"cache\" : \"cache recente\";\n  if (source?.fallback || source?.route === \"fallback\") return compact ? \"fb\" : \"fallback\";\n  if (source?.route === \"no-new\") return compact ? \"sem novas\" : \"sem novas publicações\";\n  if (source?.ok && Number(source?.count) > 0) return compact ? \"dir\" : \"coleta direta\";\n  return \"\";\n}\n\nfunction portalCardMarkup(source) {\n  const available = source.ok && Number(source.count) > 0;\n  const portalAttribute = available ? `data-portal=\"${escapeHtml(source.name)}\"` : \"disabled\";\n  const route = sourceRouteLabel(source);\n  const detail = available\n    ? `${Number(source.count)} ${Number(source.count) === 1 ? \"conteúdo recolhido\" : \"conteúdos recolhidos\"}${route ? ` · ${route}` : \"\"}`\n    : source.ok ? `Nenhuma notícia recente${source.windowHours ? ` nas últimas ${source.windowHours} horas` : \"\"}` : \"Fonte indisponível nesta ronda\";\n  const stateClass = source.ok ? `ok${source.cached ? \" cache\" : \"\"}` : \"error\";\n  return `<button class=\"portal-card ${stateClass}${state.portal === source.name ? \" selected\" : \"\"}\" ${portalAttribute} type=\"button\"><span class=\"portal-icon\">${escapeHtml(sourceInitials(source.name))}</span><span class=\"portal-card-copy\"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(detail)}</small></span><span class=\"portal-state\">${available ? \"Ver notícias →\" : source.ok ? \"Sem novas\" : \"Sem coleta\"}</span></button>`;\n}\n\nfunction renderPortalCards() {\n  const holder = document.getElementById(\"sourcePortalGrid\");\n  const sources = state.data?.sources || [];\n  if (!sources.length) {\n    holder.innerHTML = '<div class=\"empty sources-empty\"><strong>Nenhuma fonte consultada ainda</strong><span>Execute uma ronda para carregar os portais.</span></div>';\n    return;\n  }\n  holder.innerHTML = [\"Brasil\", \"Mundo\", \"Rede\"].map((region) => {\n    const regionalSources = sources.filter((source) => sourceRegion(source) === region);\n    if (!regionalSources.length) return \"\";\n    const label = region === \"Rede\" ? \"Complemento social\" : region;\n    const available = regionalSources.filter((source) => source.ok && Number(source.count) > 0).length;\n    return `<section class=\"source-region-group\"><div class=\"source-region-heading\"><h3>${escapeHtml(label)}</h3><span>${available}/${regionalSources.length} ${regionalSources.length === 1 ? \"fonte disponível\" : \"fontes disponíveis\"}</span></div><div class=\"source-region-grid\">${regionalSources.map(portalCardMarkup).join(\"\")}</div></section>`;\n  }).join(\"\");\n}\n\nfunction renderSourceHealth(message = \"\", warning = false) {\n  const holder = document.getElementById(\"sourceHealth\");\n  if (message) {\n    holder.innerHTML = `<span class=\"health-message ${warning ? \"warn\" : \"\"}\">${escapeHtml(message)}</span>`;\n    return;\n  }\n  const sources = state.data?.sources || [];\n  if (!sources.length) {\n    holder.innerHTML = '<span class=\"health-label\">Fontes ainda não consultadas</span>';\n    return;\n  }\n  const portals = sources.filter((source) => sourceRegion(source) !== \"Rede\");\n  const okCount = portals.filter((source) => source.ok && Number(source.count) > 0).length;\n  holder.innerHTML = `<span class=\"health-label\">Portais ${okCount}/${portals.length}</span>${[\"Brasil\", \"Mundo\", \"Rede\"].map((region) => {\n    const regionalSources = sources.filter((source) => sourceRegion(source) === region);\n    if (!regionalSources.length) return \"\";\n    return `<span class=\"health-region\">${escapeHtml(region)}</span>${regionalSources.map((source) => {\n      const available = source.ok && Number(source.count) > 0;\n      const portalAttribute = available ? `data-portal=\"${escapeHtml(source.name)}\"` : \"disabled\";\n      const route = sourceRouteLabel(source);\n      const title = source.error || (available ? `Mostrar somente os ${source.count} conteúdos recolhidos de ${source.name}${route ? ` por ${route}` : \"\"}${source.warning ? `. Aviso: ${source.warning}` : \"\"}` : `Nenhum conteúdo recente de ${source.name}${source.windowHours ? ` nas últimas ${source.windowHours} horas` : \"\"}`);\n      const status = available ? `${source.count}${sourceRouteLabel(source, true) ? ` ${sourceRouteLabel(source, true)}` : \"\"}` : source.ok ? \"sem novas\" : \"falhou\";\n      const stateClass = source.ok ? `ok${source.cached ? \" cache\" : \"\"}` : \"error\";\n      return `<button class=\"health-chip ${stateClass}${state.portal === source.name ? \" selected\" : \"\"}\" ${portalAttribute} type=\"button\" aria-pressed=\"${state.portal === source.name}\" title=\"${escapeHtml(title)}\"><span class=\"health-icon\">${escapeHtml(sourceInitials(source.name))}</span>${escapeHtml(source.name)} · ${escapeHtml(status)}</button>`;\n    }).join(\"\")}`;\n  }).join(\"\")}`;\n}\n\nfunction setSourceSegment(value) {\n  state.source = value;\n  document.querySelectorAll(\"#sourceFilter button\").forEach((button) => button.classList.toggle(\"active\", button.dataset.value === value));\n}\n\nfunction setRegionSegment(value) {\n  state.region = value;\n  document.querySelectorAll(\"#regionFilter button\").forEach((button) => button.classList.toggle(\"active\", button.dataset.value === value));\n}\n\nfunction updatePortalFilter() {\n  const holder = document.getElementById(\"portalFilter\");\n  holder.hidden = !state.portal;\n  document.getElementById(\"portalFilterName\").textContent = state.portal || \"\";\n}\n\nfunction showView(view) {\n  state.view = view;\n  roundView.hidden = view !== \"round\";\n  sourcesView.hidden = view !== \"sources\";\n  customSourcesView.hidden = view !== \"custom-sources\";\n  monitoringView.hidden = view !== \"monitoring\";\n  document.getElementById(\"navRound\").classList.toggle(\"active\", view === \"round\");\n  document.getElementById(\"navSources\").classList.toggle(\"active\", view === \"sources\");\n  document.getElementById(\"navCustomSources\").classList.toggle(\"active\", view === \"custom-sources\");\n  document.getElementById(\"navMonitoring\").classList.toggle(\"active\", view === \"monitoring\");\n  if (view === \"sources\") renderPortalCards();\n  if (view === \"custom-sources\") loadCustomSources();\n  if (view === \"monitoring\") {\n    loadMonitoringTerms();\n    renderDedicatedMonitoring();\n  }\n}\n\nfunction operationHeaders() {\n  const token = operationToken();\n  return { \"Content-Type\": \"application/json\", ...(token ? { \"X-Round-Token\": token } : {}) };\n}\n\nfunction handleConfigurationError(error, messageId) {\n  document.getElementById(messageId).textContent = error.message;\n  if (error.status === 401) {\n    document.getElementById(\"tokenMessage\").textContent = \"Informe a chave do Worker para alterar sites e termos.\";\n    openModal(\"settingsModal\");\n  }\n}\n\nfunction renderCustomSources() {\n  const holder = document.getElementById(\"customSourcesList\");\n  const active = state.customSources.filter((source) => source.active).length;\n  document.getElementById(\"customSourcesLimit\").textContent = `${active}/${state.customSourcesLimit} ativos`;\n  if (!state.customSources.length) {\n    holder.innerHTML = '<div class=\"empty config-empty\"><strong>Nenhum site cadastrado</strong><span>Cadastre um endereço para incluí-lo nas próximas rondas automáticas.</span></div>';\n    return;\n  }\n  holder.innerHTML = state.customSources.map((source) => `<article class=\"config-row ${source.active ? \"\" : \"inactive\"}\"><div class=\"config-status\">${source.active ? \"Ativo\" : \"Pausado\"}</div><div class=\"config-main\"><strong>${escapeHtml(source.name)}</strong><a href=\"${escapeHtml(safeUrl(source.url))}\" target=\"_blank\" rel=\"noreferrer\">${escapeHtml(source.url)}</a><small>${escapeHtml(source.region)} · ${source.active ? \"entra nas próximas rondas\" : \"fora da coleta\"}</small></div><div class=\"config-actions\"><button class=\"secondary\" data-custom-toggle=\"${escapeHtml(source.id)}\" data-next-active=\"${source.active ? \"false\" : \"true\"}\" type=\"button\">${source.active ? \"Pausar\" : \"Ativar\"}</button><button class=\"danger-button\" data-custom-delete=\"${escapeHtml(source.id)}\" type=\"button\">Remover</button></div></article>`).join(\"\");\n}\n\nasync function loadCustomSources() {\n  try {\n    const response = await api(`/api/custom-sources?t=${Date.now()}`);\n    state.customSources = Array.isArray(response?.sources) ? response.sources : [];\n    state.customSourcesLimit = Number(response?.limits?.maximumActive) || 8;\n    renderCustomSources();\n  } catch (error) {\n    document.getElementById(\"customSourcesList\").innerHTML = `<div class=\"empty config-empty\"><strong>Não foi possível carregar os sites</strong><span>${escapeHtml(error.message)}</span></div>`;\n  }\n}\n\nasync function submitCustomSource(event) {\n  event.preventDefault();\n  const message = document.getElementById(\"customSourceMessage\");\n  message.textContent = \"Salvando…\";\n  try {\n    await api(\"/api/custom-sources\", {\n      method: \"POST\",\n      headers: operationHeaders(),\n      body: JSON.stringify({\n        name: document.getElementById(\"customSourceName\").value,\n        url: document.getElementById(\"customSourceUrl\").value,\n        region: document.getElementById(\"customSourceRegion\").value,\n      }),\n    });\n    event.currentTarget.reset();\n    message.textContent = \"Site cadastrado. Ele será incluído na próxima ronda automática.\";\n    await loadCustomSources();\n  } catch (error) {\n    handleConfigurationError(error, \"customSourceMessage\");\n  }\n}\n\nasync function changeCustomSource(id, options) {\n  const message = document.getElementById(\"customSourceMessage\");\n  message.textContent = \"Atualizando cadastro…\";\n  try {\n    await api(`/api/custom-sources/${encodeURIComponent(id)}`, {\n      method: options.delete ? \"DELETE\" : \"PATCH\",\n      headers: operationHeaders(),\n      ...(options.delete ? {} : { body: JSON.stringify({ active: options.active }) }),\n    });\n    message.textContent = options.delete ? \"Site removido.\" : options.active ? \"Site ativado para as próximas rondas.\" : \"Site pausado.\";\n    await loadCustomSources();\n  } catch (error) {\n    handleConfigurationError(error, \"customSourceMessage\");\n  }\n}\n\nfunction renderMonitoringTerms() {\n  const holder = document.getElementById(\"monitoringTermsList\");\n  const activeTerms = state.monitoringTerms.filter((term) => term.active);\n  document.getElementById(\"monitoringTermsLimit\").textContent = `${activeTerms.length}/${state.monitoringTermsLimit} ativos`;\n  if (!state.monitoringTerms.length) {\n    holder.innerHTML = '<div class=\"empty config-empty\"><strong>Nenhum termo cadastrado</strong><span>Exemplo: Vini Jr, inteligência artificial ou nome de uma empresa.</span></div>';\n  } else {\n    holder.innerHTML = state.monitoringTerms.map((term) => `<article class=\"config-row term-row ${term.active ? \"\" : \"inactive\"}\"><div class=\"config-status\">${term.active ? \"Ativo\" : \"Pausado\"}</div><div class=\"config-main\"><strong>${escapeHtml(term.term)}</strong><small>${term.active ? \"busca dedicada em todas as rondas\" : \"resultados ocultos e busca pausada\"}</small></div><div class=\"config-actions\"><button class=\"secondary\" data-term-toggle=\"${escapeHtml(term.id)}\" data-next-active=\"${term.active ? \"false\" : \"true\"}\" type=\"button\">${term.active ? \"Pausar\" : \"Ativar\"}</button><button class=\"danger-button\" data-term-delete=\"${escapeHtml(term.id)}\" type=\"button\">Remover</button></div></article>`).join(\"\");\n  }\n  if (!activeTerms.some((term) => term.id === state.monitoringTermFilter)) state.monitoringTermFilter = \"all\";\n  renderDedicatedMonitoring();\n}\n\nasync function loadMonitoringTerms() {\n  try {\n    const response = await api(`/api/monitoring-terms?t=${Date.now()}`);\n    state.monitoringTerms = Array.isArray(response?.terms) ? response.terms : [];\n    state.monitoringTermsLimit = Number(response?.limits?.maximumActive) || 6;\n    renderMonitoringTerms();\n  } catch (error) {\n    document.getElementById(\"monitoringTermsList\").innerHTML = `<div class=\"empty config-empty\"><strong>Não foi possível carregar os termos</strong><span>${escapeHtml(error.message)}</span></div>`;\n  }\n}\n\nasync function submitMonitoringTerm(event) {\n  event.preventDefault();\n  const message = document.getElementById(\"monitoringTermMessage\");\n  message.textContent = \"Salvando…\";\n  try {\n    await api(\"/api/monitoring-terms\", {\n      method: \"POST\",\n      headers: operationHeaders(),\n      body: JSON.stringify({ term: document.getElementById(\"monitoringTermInput\").value }),\n    });\n    event.currentTarget.reset();\n    message.textContent = \"Termo adicionado. Os resultados chegarão na próxima ronda automática.\";\n    await loadMonitoringTerms();\n  } catch (error) {\n    handleConfigurationError(error, \"monitoringTermMessage\");\n  }\n}\n\nasync function changeMonitoringTerm(id, options) {\n  const message = document.getElementById(\"monitoringTermMessage\");\n  message.textContent = \"Atualizando termo…\";\n  try {\n    await api(`/api/monitoring-terms/${encodeURIComponent(id)}`, {\n      method: options.delete ? \"DELETE\" : \"PATCH\",\n      headers: operationHeaders(),\n      ...(options.delete ? {} : { body: JSON.stringify({ active: options.active }) }),\n    });\n    message.textContent = options.delete ? \"Termo removido e resultados ocultados.\" : options.active ? \"Termo reativado.\" : \"Termo pausado e resultados ocultados.\";\n    await loadMonitoringTerms();\n  } catch (error) {\n    handleConfigurationError(error, \"monitoringTermMessage\");\n  }\n}\n\nfunction renderDedicatedMonitoring() {\n  const filterHolder = document.getElementById(\"monitoringTermFilters\");\n  const newsHolder = document.getElementById(\"dedicatedNewsList\");\n  const activeTerms = state.monitoringTerms.filter((term) => term.active);\n  const allowedIds = new Set(activeTerms.map((term) => term.id));\n  const monitoring = state.data?.dedicatedMonitoring || {};\n  const allItems = (monitoring.items || []).filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => allowedIds.has(term.id)));\n  const visible = state.monitoringTermFilter === \"all\"\n    ? allItems\n    : allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => term.id === state.monitoringTermFilter));\n  filterHolder.innerHTML = activeTerms.length\n    ? `<button class=\"${state.monitoringTermFilter === \"all\" ? \"active\" : \"\"}\" data-monitoring-filter=\"all\" type=\"button\">Todos · ${allItems.length}</button>${activeTerms.map((term) => {\n      const count = allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((match) => match.id === term.id)).length;\n      return `<button class=\"${state.monitoringTermFilter === term.id ? \"active\" : \"\"}\" data-monitoring-filter=\"${escapeHtml(term.id)}\" type=\"button\">${escapeHtml(term.term)} · ${count}</button>`;\n    }).join(\"\")}`\n    : \"\";\n  document.getElementById(\"dedicatedMonitoringMeta\").textContent = state.data?.collectedAt\n    ? `${visible.length} resultado${visible.length === 1 ? \"\" : \"s\"} · ${relativeTime(state.data.collectedAt)}`\n    : \"Aguardando a primeira ronda\";\n  if (!activeTerms.length) {\n    newsHolder.innerHTML = '<div class=\"empty\"><strong>Nenhum termo ativo</strong><span>Adicione ou reative um termo para iniciar a busca dedicada.</span></div>';\n    return;\n  }\n  if (!visible.length) {\n    newsHolder.innerHTML = '<div class=\"empty\"><strong>Nenhuma notícia encontrada na última ronda</strong><span>O termo continuará sendo procurado automaticamente a cada cinco minutos.</span></div>';\n    return;\n  }\n  newsHolder.innerHTML = visible.map((item) => {\n    const tags = (item.matchedTerms || [{ id: item.monitoringTermId, term: item.monitoringTerm }])\n      .filter((term) => allowedIds.has(term.id))\n      .map((term) => `<span>${escapeHtml(term.term)}</span>`)\n      .join(\"\");\n    return `<article class=\"dedicated-news\"><div class=\"dedicated-news-meta\"><strong>${escapeHtml(item.sourceName || item.collectorName || \"Fonte não informada\")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><div class=\"dedicated-tags\">${tags}</div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : \"\"}<a href=\"${escapeHtml(safeUrl(item.url))}\" target=\"_blank\" rel=\"noreferrer\">Abrir notícia ↗</a></article>`;\n  }).join(\"\");\n}\n\nfunction filterByPortal(name) {\n  state.portal = name || null;\n  const matchingItem = (state.data?.items || []).find((item) => item.collectorName === name || item.sourceName === name);\n  const matchingSource = (state.data?.sources || []).find((source) => source.name === name);\n  setSourceSegment(name ? (name === \"Bluesky\" || matchingItem?.kind === \"social\" ? \"Rede\" : \"Portal\") : \"Todos\");\n  setRegionSegment(name && sourceRegion(matchingSource) !== \"Rede\" ? sourceRegion(matchingSource) : \"Todas\");\n  state.expanded.clear();\n  showView(\"round\");\n  updatePortalFilter();\n  renderSourceHealth();\n  renderPortalCards();\n  render();\n  document.querySelector(\".controls\").scrollIntoView({ behavior: \"smooth\", block: \"start\" });\n}\n\nfunction render() {\n  const topics = state.data?.topics || [];\n  const query = state.query.trim().toLocaleLowerCase(\"pt-BR\");\n  const visible = topics\n    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))\n    .filter((topic) => topic.items.length && (state.editoria === \"Todas\" || (topic.editoria || \"Notícias\") === state.editoria) && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(\" \")}`.toLocaleLowerCase(\"pt-BR\").includes(query)));\n\n  document.getElementById(\"summaryTopics\").textContent = visible.length;\n  document.getElementById(\"summaryContents\").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);\n  document.getElementById(\"summaryChannels\").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;\n  document.getElementById(\"summaryUrgent\").textContent = visible.filter((topic) => topic.tone === \"urgent\").length;\n  updatePortalFilter();\n\n  if (!state.data) {\n    grid.innerHTML = '<div class=\"empty\"><strong>Nenhuma ronda disponível</strong><span>A primeira coleta será executada pelo agendamento online ou pelo botão Executar ronda.</span></div>';\n    return;\n  }\n  if (!visible.length) {\n    grid.innerHTML = '<div class=\"empty\"><strong>Nenhum assunto neste filtro</strong><span>Retire um filtro ou aguarde uma nova ronda.</span></div>';\n    return;\n  }\n\n  grid.innerHTML = visible.map((topic) => {\n    const items = [...topic.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));\n    const primary = items.find((item) => item.kind === \"portal\") || items[0];\n    const additional = items.filter((item) => item.id !== primary.id);\n    const sources = [...new Set(items.map((item) => item.sourceName))];\n    const latest = items[0].publishedAt;\n    const open = state.expanded.has(topic.id);\n    const editoria = topic.editoria || \"Notícias\";\n    const carousel = topic.carousel || {};\n    return `<article class=\"card ${escapeHtml(topic.tone)}\"><div class=\"accent\"></div><div class=\"card-body\"><div class=\"topline\"><div class=\"topic-labels\"><span class=\"priority\"><i></i>${escapeHtml(topic.priority)}</span><span class=\"editoria-badge\">${escapeHtml(editoria)}</span></div><span class=\"score\">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class=\"card-sources\"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<button class=\"source-badge\" data-portal=\"${escapeHtml(source)}\" type=\"button\" title=\"Filtrar por ${escapeHtml(source)}\">${escapeHtml(source)}</button>`).join(\"\")}${sources.length > 6 ? `<span class=\"source-badge\">+${sources.length - 6}</span>` : \"\"}</div><div class=\"published\"><span>Última postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class=\"relative\">${escapeHtml(relativeTime(latest))}</span></div><div class=\"momentum\"><span class=\"trend\">↗</span><span>${escapeHtml(topic.momentum)}</span><span class=\"calculated\">calculado nesta ronda</span></div><div class=\"recommendation\"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || \"Confirmar as informações nas fontes originais antes de publicar.\")}</div><div class=\"carousel-teaser\"><div><span>Leitura inteligente</span><strong>Leitura de 1 matéria selecionada com fallback da mesma fonte</strong></div><div><span>Formato</span><strong>${escapeHtml(carousel.postModel || \"Instagram · 7 slides\")}</strong></div><button data-carousel-topic=\"${escapeHtml(topic.id)}\" type=\"button\">Gerar roteiro de carrossel →</button></div>${sourceMarkup(primary, true)}${additional.length ? `<button class=\"toggle\" data-toggle=\"${escapeHtml(topic.id)}\" aria-expanded=\"${open}\" type=\"button\"><span>${open ? \"Ocultar outros conteúdos\" : `Ver mais ${additional.length} ${additional.length === 1 ? \"conteúdo\" : \"conteúdos\"}`}</span><span>${open ? \"⌃\" : \"⌄\"}</span></button>` : \"\"}${open ? `<div class=\"source-list\">${additional.map((item) => sourceMarkup(item)).join(\"\")}</div>` : \"\"}</div></article>`;\n  }).join(\"\");\n\n  grid.querySelectorAll(\"[data-toggle]\").forEach((button) => button.addEventListener(\"click\", () => {\n    const id = button.dataset.toggle;\n    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);\n    render();\n  }));\n}\n\nfunction applyRound(payload) {\n  if (!payload?.ok || !Array.isArray(payload.topics)) return;\n  state.data = payload;\n  state.lastRunId = payload.runId || state.lastRunId;\n  state.expanded.clear();\n  document.getElementById(\"lastUpdate\").textContent = `Última coleta: ${formatDate(payload.collectedAt)}`;\n  renderSourceHealth();\n  renderPortalCards();\n  renderDedicatedMonitoring();\n  render();\n}\n\nasync function loadLatest({ quiet = false } = {}) {\n  try {\n    const response = await api(`/api/latest?t=${Date.now()}`);\n    const payload = response?.data;\n    if (payload?.ok && (!state.lastRunId || payload.runId !== state.lastRunId)) applyRound(payload);\n    return payload;\n  } catch (error) {\n    if (!quiet) renderSourceHealth(error.message);\n    return null;\n  }\n}\n\nfunction openModal(id) {\n  const modal = document.getElementById(id);\n  modal.hidden = false;\n  const input = modal.querySelector(\"input\");\n  if (input) setTimeout(() => input.focus(), 0);\n}\n\nfunction closeModal(id) {\n  document.getElementById(id).hidden = true;\n  if (id === \"carouselModal\") state.carouselRequestSerial += 1;\n}\n\nfunction operationToken() {\n  try { return localStorage.getItem(STORAGE_TOKEN) || \"\"; } catch { return \"\"; }\n}\n\nfunction wait(milliseconds) {\n  return new Promise((resolve) => setTimeout(resolve, milliseconds));\n}\n\nasync function waitForRun(runId) {\n  for (let attempt = 0; attempt < 40; attempt += 1) {\n    await wait(attempt === 0 ? 1_000 : 2_500);\n    try {\n      const payload = await api(`/api/runs/${encodeURIComponent(runId)}?t=${Date.now()}`);\n      const run = payload?.run;\n      if (run?.status === \"success\") return run;\n      if (run?.status === \"failed\") throw new Error(run.error || \"A coleta não encontrou conteúdo válido.\");\n      setStatus(\"\", \"Ronda em andamento\", `Coletando fontes… ${Math.min(99, 5 + attempt * 3)}%`);\n    } catch (error) {\n      if (error.status === 404) continue;\n      throw error;\n    }\n  }\n  throw new Error(\"A ronda continua no servidor. O painel será atualizado automaticamente quando ela terminar.\");\n}\n\nasync function executeRound(automatic = false) {\n  if (state.running) return;\n  const token = operationToken();\n  if (state.health?.manualAuthRequired && !token) {\n    document.getElementById(\"tokenMessage\").textContent = \"Informe a chave configurada no Worker para executar manualmente.\";\n    openModal(\"settingsModal\");\n    return;\n  }\n  state.running = true;\n  runButton.disabled = true;\n  runButton.classList.add(\"loading\");\n  runButton.innerHTML = \"<span>↻</span>Coletando fontes…\";\n  setStatus(\"\", \"Ronda em andamento\", \"Consultando portais e fontes sociais\");\n  try {\n    const payload = await api(\"/api/round\", {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\", ...(token ? { \"X-Round-Token\": token } : {}) },\n      body: JSON.stringify({ source: automatic ? \"initial\" : \"button\" }),\n    });\n    if (!payload?.runId && payload?.data?.ok) {\n      applyRound(payload.data);\n      const legacyTime = payload.data.collectedAt || payload.data.storedAt || new Date().toISOString();\n      setStatus(\"ok\", \"Ronda concluída\", `Coleta finalizada às ${new Date(legacyTime).toLocaleTimeString(\"pt-BR\", { hour: \"2-digit\", minute: \"2-digit\" })}`);\n      return;\n    }\n    if (!payload?.runId) throw new Error(\"O servidor retornou uma resposta de ronda incompatível. Publique todos os arquivos da mesma versão.\");\n    setStatus(\"\", \"Ronda iniciada\", \"O servidor está consultando os portais\");\n    await waitForRun(payload.runId);\n    const completed = await loadLatest();\n    if (!completed?.ok) throw new Error(\"A ronda terminou, mas o resultado ainda não foi carregado.\");\n    const completedAt = completed.collectedAt || completed.storedAt || new Date().toISOString();\n    setStatus(\"ok\", \"Ronda concluída\", `Coleta finalizada às ${new Date(completedAt).toLocaleTimeString(\"pt-BR\", { hour: \"2-digit\", minute: \"2-digit\" })}`);\n  } catch (error) {\n    if (error.status === 401) {\n      document.getElementById(\"tokenMessage\").textContent = \"Chave incorreta. Confira a variável MANUAL_ROUND_TOKEN.\";\n      openModal(\"settingsModal\");\n    }\n    const locked = error.status === 409 || error.status === 429;\n    const pending = error.message.startsWith(\"A ronda continua no servidor\");\n    setStatus(locked || pending ? \"warn\" : \"error\", pending ? \"Ronda ainda em andamento\" : locked ? \"Ronda já em andamento\" : \"Falha ao executar a ronda\", error.message);\n    if (!pending) renderSourceHealth(error.message, locked);\n  } finally {\n    state.running = false;\n    runButton.disabled = false;\n    runButton.classList.remove(\"loading\");\n    runButton.innerHTML = \"<span>↻</span>Executar ronda\";\n  }\n}\n\nasync function checkHealth() {\n  try {\n    const health = await api(`/api/health?t=${Date.now()}`);\n    if (!health || typeof health !== \"object\" || !health.version) throw new Error(\"A versão publicada do Worker não é compatível com este painel.\");\n    state.health = health;\n    const translationReady = health.translation?.ready !== false;\n    const automationMessage = !translationReady\n      ? \"Automação ativa; tradução internacional indisponível no Cloudflare.\"\n      : health.schedulerHealthy\n      ? \"Automação online ativa e atualizada.\"\n      : health.lastSuccessAt\n        ? \"Automação online configurada; a última ronda está atrasada.\"\n        : \"Serviço online pronto; aguardando a primeira ronda.\";\n    document.getElementById(\"automationText\").textContent = `${automationMessage} A coleta continua com a janela fechada.`;\n    setStatus(health.schedulerHealthy && translationReady ? \"ok\" : \"warn\", !translationReady ? \"Tradução não configurada\" : health.schedulerHealthy ? \"Serviço online\" : \"Aguardando automação\", !translationReady ? \"O conteúdo internacional será ocultado\" : health.lastSuccessAt ? `Última ronda ${relativeTime(health.lastSuccessAt)}` : \"Execute a primeira ronda\");\n    return true;\n  } catch (error) {\n    state.health = null;\n    setStatus(\"error\", \"Webapp não configurado\", error.message);\n    renderSourceHealth(error.message);\n    document.getElementById(\"automationText\").textContent = \"Configuração incompleta no Cloudflare.\";\n    return false;\n  }\n}\n\nasync function showHistory() {\n  openModal(\"historyModal\");\n  const holder = document.getElementById(\"historyList\");\n  const detail = document.getElementById(\"historyDetail\");\n  const back = document.getElementById(\"historyBack\");\n  holder.hidden = false;\n  detail.hidden = true;\n  back.hidden = true;\n  holder.innerHTML = '<div class=\"loading-row\">Carregando histórico…</div>';\n  try {\n    const payload = await api(\"/api/history?limit=50\");\n    const runs = payload?.runs || [];\n    holder.innerHTML = runs.length ? runs.map((run) => `<button class=\"history-row\" data-history-run=\"${escapeHtml(run.id)}\" type=\"button\" ${run.status === \"running\" ? \"disabled\" : \"\"}><span class=\"history-date\"><strong>${escapeHtml(formatDate(run.completed_at))}</strong><small>${run.trigger_type === \"scheduled\" ? \"Automática\" : \"Manual\"}</small></span><span class=\"history-status ${run.status}\">${run.status === \"success\" ? \"Concluída\" : run.status === \"running\" ? \"Em andamento\" : \"Falhou\"}</span><span>${Number(run.items_count) || 0} conteúdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span class=\"history-open\"><strong>${Number(run.sources_count) || 0} fontes</strong><small>${run.status === \"running\" ? \"Aguarde\" : \"Ver notícias →\"}</small></span></button>`).join(\"\") : '<div class=\"loading-row\">Nenhuma ronda armazenada.</div>';\n  } catch (error) {\n    holder.innerHTML = `<div class=\"loading-row\">${escapeHtml(error.message)}</div>`;\n  }\n}\n\nasync function showHistoryDetail(runId) {\n  const holder = document.getElementById(\"historyList\");\n  const detail = document.getElementById(\"historyDetail\");\n  const back = document.getElementById(\"historyBack\");\n  holder.hidden = true;\n  detail.hidden = false;\n  back.hidden = false;\n  detail.innerHTML = '<div class=\"loading-row\">Carregando as notícias desta ronda…</div>';\n  try {\n    const response = await api(`/api/runs/${encodeURIComponent(runId)}/data?t=${Date.now()}`);\n    const data = response?.data || {};\n    const run = response?.run || {};\n    const items = [...(data.items || [])].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));\n    const sourceCounts = new Map();\n    for (const item of items) {\n      const source = item.collectorName || item.sourceName || \"Fonte não informada\";\n      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);\n    }\n    const sourceChips = [...sourceCounts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `<span>${escapeHtml(name)} · ${count}</span>`).join(\"\");\n    const news = items.length ? items.map((item) => `<article class=\"history-news\"><div class=\"history-news-meta\"><span class=\"kind ${escapeHtml((item.platform || item.kind || \"fonte\").toLowerCase())}\">${escapeHtml(item.platform || (item.kind === \"social\" ? \"Rede\" : \"Portal\"))}</span><strong>${escapeHtml(item.sourceName || item.collectorName || \"Fonte não informada\")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : \"\"}<a href=\"${escapeHtml(safeUrl(item.url))}\" target=\"_blank\" rel=\"noreferrer\">Abrir para apuração ↗</a></article>`).join(\"\") : '<div class=\"empty history-empty\"><strong>Nenhuma notícia armazenada nesta ronda</strong><span>Consulte o estado das fontes ou selecione outra ronda.</span></div>';\n    detail.innerHTML = `<section class=\"history-detail-head\"><p class=\"eyebrow\">Notícias apuradas neste período</p><h3>${escapeHtml(formatDate(run.completedAt || data.collectedAt))}</h3><p>${run.triggerType === \"scheduled\" ? \"Ronda automática\" : \"Ronda manual\"} · ${items.length} conteúdos · ${Number(data.totals?.topics) || 0} assuntos</p></section>${sourceChips ? `<div class=\"history-source-chips\">${sourceChips}</div>` : \"\"}<div class=\"history-news-list\">${news}</div>`;\n  } catch (error) {\n    detail.innerHTML = `<div class=\"loading-row\">${escapeHtml(error.message)}</div>`;\n  }\n}\n\nfunction topicVerificationLinks(topic) {\n  const storedLinks = Array.isArray(topic?.carousel?.verificationLinks) ? topic.carousel.verificationLinks : [];\n  const candidates = storedLinks.length ? storedLinks : (topic?.items || []);\n  const links = [];\n  const seen = new Set();\n  for (const item of candidates) {\n    const url = safeUrl(item?.url);\n    if (url === \"#\" || seen.has(url)) continue;\n    seen.add(url);\n    links.push({\n      title: item?.title || \"Notícia sem título\",\n      sourceName: item?.sourceName || item?.collectorName || \"Fonte não informada\",\n      publishedAt: item?.publishedAt || null,\n      url,\n    });\n  }\n  return links;\n}\n\nfunction entityLine(label, values) {\n  const list = Array.isArray(values) ? values.filter(Boolean) : [];\n  return `${label}: ${list.length ? list.join(\", \") : \"Não identificado\"}`;\n}\n\nfunction carouselAsText(topic, carousel) {\n  const slides = Array.isArray(carousel?.slides) ? carousel.slides : [];\n  const verificationLinks = Array.isArray(carousel?.verificationLinks) && carousel.verificationLinks.length\n    ? carousel.verificationLinks\n    : topicVerificationLinks(topic);\n  const questions = carousel?.questions || {};\n  const entities = carousel?.entities || {};\n  const reading = carousel?.reading || {};\n  const facts = Array.isArray(carousel?.facts) ? carousel.facts : [];\n  return [\n    `ROTEIRO DE CARROSSEL — ${topic.editoria || \"Notícias\"}`,\n    \"LEITURA INTELIGENTE — UMA MATÉRIA POR SUGESTÃO\",\n    `Modo: ${carousel?.analysisMode === \"ai\" ? \"Workers AI\" : \"Análise automática de contingência\"}`,\n    `Qualidade: ${reading.qualityLabel || \"Conteúdo disponível\"}`,\n    `Fonte selecionada: ${reading.selectedSource?.sourceName || reading.sources?.[0]?.sourceName || \"Não informada\"}`,\n    `Leitura direta: ${Number(reading.liveSuccessful) ? \"sim\" : \"não\"}`,\n    `Fallback da mesma matéria: ${Number(reading.fallbackSources) ? \"sim\" : \"não\"}`,\n    `Ciclo encerrado: ${reading.cycleComplete ? \"sim\" : \"não\"}`,\n    `Sistema liberado para novo ciclo: ${carousel?.cycle?.nextCycleAllowed || reading.nextCycleAllowed ? \"sim\" : \"não\"}`,\n    `Palavras analisadas: ${Number(reading.totalWords) || 0}`,\n    `Tom de voz: ${carousel?.voiceTone || \"Jornalístico, factual e explicativo\"}`,\n    `Formato: ${carousel?.postModel || \"Instagram · 7 slides\"}`,\n    \"\",\n    \"INTERPRETAÇÃO DA NOTÍCIA\",\n    `O que aconteceu: ${questions.whatHappened || \"Não informado\"}`,\n    `Quem está envolvido: ${questions.who || \"Não informado\"}`,\n    `Onde aconteceu: ${questions.where || \"Não informado\"}`,\n    `Quando aconteceu: ${questions.when || \"Não informado\"}`,\n    `Qual o impacto: ${questions.impact || \"Não informado\"}`,\n    `Qual a repercussão: ${questions.repercussion || \"Não informado\"}`,\n    \"\",\n    \"DADOS ESTRUTURADOS\",\n    entityLine(\"Personagens\", entities.people),\n    entityLine(\"Empresas\", entities.companies),\n    entityLine(\"Locais\", entities.places),\n    entityLine(\"Datas\", entities.dates),\n    entityLine(\"Temas\", entities.themes),\n    entityLine(\"Palavras-chave\", entities.keywords),\n    \"\",\n    \"MAPA DE FATOS E EVIDÊNCIAS\",\n    ...facts.flatMap((fact, index) => [\n      `${index + 1}. ${fact.claim || \"\"}`,\n      `Evidência: ${fact.evidence || \"Não informada\"}`,\n      `Confiança: ${fact.confidence || \"não informada\"}`,\n      \"\",\n    ]),\n    ...slides.flatMap((slide) => [\n      `SLIDE ${slide.number} — ${String(slide.role || \"\").toUpperCase()}`,\n      slide.title || \"\",\n      slide.subtitle || slide.body || \"\",\n      \"\",\n    ]),\n    \"LINKS PARA APURAÇÃO\",\n    ...verificationLinks.flatMap((link, index) => [\n      `${index + 1}. ${link.title}`,\n      `Portal: ${link.sourceName}`,\n      `URL: ${link.url}`,\n      \"\",\n    ]),\n    carousel?.disclaimer || \"Revise e confirme as informações antes de publicar.\",\n  ].join(\"\\n\").trim();\n}\n\nfunction carouselCacheKey(topicId) {\n  return `${state.data?.runId || state.lastRunId || \"latest\"}:${topicId}`;\n}\n\nfunction setCarouselLoading(loading, message = \"\", options = {}) {\n  state.carouselLoading = loading;\n  const holder = document.getElementById(\"carouselLoading\");\n  holder.hidden = false;\n  holder.classList.toggle(\"error\", !loading && Boolean(message));\n  const progress = Math.max(0, Math.min(100, Number(options.progress) || 0));\n  const title = options.title || (loading ? \"Leitura inteligente em andamento\" : \"Roteiro não concluído\");\n  if (loading) {\n    holder.innerHTML = `<span class=\"reader-spinner\">↻</span><div class=\"reader-copy\"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message || \"Abrindo uma matéria e preparando o roteiro.\")}</small><div class=\"reader-progress\"><i style=\"width:${progress}%\"></i></div><em>${progress}%</em></div>`;\n  } else {\n    const retry = options.retry ? '<button class=\"reader-retry\" data-retry-carousel type=\"button\">Tentar novamente</button>' : \"\";\n    holder.innerHTML = `<span class=\"reader-error\">!</span><div class=\"reader-copy\"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>${retry}</div>`;\n  }\n  document.getElementById(\"copyCarousel\").disabled = loading || Boolean(message);\n}\n\nfunction setCarouselJobProgress(job = {}) {\n  const statusTitle = job.status === \"queued\" ? \"Leitura adicionada à fila\" : \"Leitura inteligente em andamento\";\n  setCarouselLoading(true, job.message || \"Processando a matéria selecionada.\", {\n    progress: Number(job.progress) || 1,\n    title: statusTitle,\n  });\n}\n\nasync function waitForIntelligentJob(jobId, requestSerial, pollAfterMs = 1_200) {\n  const deadline = Date.now() + 180_000;\n  while (Date.now() < deadline) {\n    if (requestSerial !== state.carouselRequestSerial) return null;\n    await wait(Math.max(700, Number(pollAfterMs) || 1_200));\n    if (requestSerial !== state.carouselRequestSerial) return null;\n    const response = await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);\n    const job = response?.job || {};\n    if (job.status === \"succeeded\" && response?.data?.slides?.length) return response.data;\n    if (job.status === \"failed\") {\n      const detail = job.error || job.message || \"O processamento foi interrompido.\";\n      throw new Error(`${detail} O ciclo foi encerrado e o sistema está liberado para tentar uma nova leitura.`);\n    }\n    setCarouselJobProgress(job);\n  }\n  throw new Error(\"A leitura ultrapassou três minutos. O processamento pode continuar na fila; feche e abra novamente este assunto para consultar o resultado.\");\n}\n\nfunction questionCard(label, value) {\n  return `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value || \"Não informado no conteúdo coletado.\")}</p></article>`;\n}\n\nfunction entityGroup(label, values) {\n  const list = Array.isArray(values) ? values.filter(Boolean) : [];\n  return `<div><small>${escapeHtml(label)}</small><div class=\"entity-chips\">${list.length ? list.map((item) => `<span>${escapeHtml(item)}</span>`).join(\"\") : '<em>Não identificado</em>'}</div></div>`;\n}\n\nfunction confidenceLabel(value) {\n  if (value === \"high\") return \"Alta\";\n  if (value === \"medium\") return \"Média\";\n  return \"Baixa\";\n}\n\nfunction slideEditorMarkup(slide, index) {\n  const title = String(slide.title || \"\");\n  const subtitle = String(slide.subtitle || slide.body || \"\");\n  return `<article class=\"carousel-slide\" data-slide-index=\"${index}\"><div><span>${Number(slide.number) || \"\"}</span><small>${escapeHtml(slide.role)}</small></div><h3 contenteditable=\"true\" spellcheck=\"true\" data-slide-title=\"${index}\" aria-label=\"Editar título do slide ${index + 1}\">${escapeHtml(title)}</h3><p contenteditable=\"true\" spellcheck=\"true\" data-slide-subtitle=\"${index}\" aria-label=\"Editar subtítulo do slide ${index + 1}\">${escapeHtml(subtitle).replace(/\\n/g, \"<br>\")}</p><footer><span data-title-count>${title.length}/68</span><span data-subtitle-count>${subtitle.length}/190</span></footer></article>`;\n}\n\nfunction updateEditedSlide(target) {\n  const holder = target.closest(\"[data-slide-index]\");\n  const index = Number(holder?.dataset.slideIndex);\n  const topic = (state.data?.topics || []).find((item) => item.id === state.activeTopicId);\n  const slide = state.activeCarousel?.slides?.[index];\n  if (!holder || !slide || !topic) return;\n  const title = holder.querySelector(\"[data-slide-title]\")?.innerText.trim() || \"\";\n  const subtitle = holder.querySelector(\"[data-slide-subtitle]\")?.innerText.trim() || \"\";\n  slide.title = title;\n  slide.subtitle = subtitle;\n  slide.body = subtitle;\n  holder.querySelector(\"[data-title-count]\").textContent = `${title.length}/68`;\n  holder.querySelector(\"[data-subtitle-count]\").textContent = `${subtitle.length}/190`;\n  holder.classList.toggle(\"over-limit\", title.length > 68 || subtitle.length > 190);\n  state.carouselText = carouselAsText(topic, state.activeCarousel);\n}\n\nfunction renderIntelligentCarousel(topic, carousel) {\n  document.getElementById(\"carouselLoading\").hidden = true;\n  document.getElementById(\"carouselTitle\").textContent = topic.title;\n  state.activeCarousel = {\n    ...carousel,\n    slides: (carousel.slides || []).map((slide) => ({ ...slide, evidenceIds: [...(slide.evidenceIds || [])] })),\n  };\n  const reading = carousel.reading || {};\n  document.getElementById(\"carouselMeta\").innerHTML = `<span><small>Editoria</small><strong>${escapeHtml(topic.editoria || \"Notícias\")}</strong></span><span><small>Idioma</small><strong>Português</strong></span><span><small>Tom de voz</small><strong>${escapeHtml(carousel.voiceTone || \"Jornalístico e factual\")}</strong></span><span><small>Formato</small><strong>${escapeHtml(carousel.postModel || \"Instagram · 7 slides\")}</strong></span><span><small>Análise</small><strong>${carousel.analysisMode === \"ai\" ? \"Workers AI\" : \"Contingência automática\"}</strong></span>`;\n  const readingHolder = document.getElementById(\"carouselReading\");\n  readingHolder.hidden = false;\n  const selectedSource = reading.selectedSource || (reading.sources || [])[0] || {};\n  const modeLabel = selectedSource.readMode === \"full-article-cache\" ? \"Texto em cache\" : Number(reading.liveSuccessful) ? \"Texto da matéria\" : \"Fallback do feed\";\n  const selection = selectedSource.selection || {};\n  const cycleReleased = Boolean(carousel.cycle?.released && carousel.cycle?.nextCycleAllowed && reading.cycleComplete);\n  readingHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Leitura de uma matéria</p><h3>Uma fonte por sugestão, com encerramento automático</h3></div><span>${cycleReleased ? \"Ciclo liberado\" : `${Number(reading.successful) || 0}/1 matéria`}</span></div><div class=\"reading-stats\"><span><small>Fonte selecionada</small><strong>${escapeHtml(selectedSource.sourceName || \"Não informada\")}</strong></span><span><small>Modo de leitura</small><strong>${escapeHtml(modeLabel)}</strong></span><span><small>Palavras analisadas</small><strong>${Number(reading.totalWords) || 0}</strong></span><span><small>Seleção</small><strong>${selection.score ? `${Number(selection.score)} pontos · ${Number(selection.candidatesEvaluated) || 1} avaliadas` : \"Melhor fonte disponível\"}</strong></span><span class=\"cycle-release\"><small>Ciclo</small><strong>${cycleReleased ? \"Encerrado · próximo ciclo liberado\" : \"Finalização pendente\"}</strong></span></div>`;\n\n  const evidenceHolder = document.getElementById(\"carouselEvidence\");\n  const facts = Array.isArray(carousel.facts) ? carousel.facts : [];\n  evidenceHolder.hidden = false;\n  evidenceHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Rastreabilidade factual</p><h3>Mapa de fatos e evidências</h3></div><span>${facts.length} ${facts.length === 1 ? \"fato validado\" : \"fatos validados\"}</span></div><div class=\"evidence-list\">${facts.length ? facts.map((fact) => `<article id=\"evidence-${escapeHtml(fact.id)}\"><div><strong>${escapeHtml(fact.claim)}</strong><small>Confiança ${escapeHtml(confidenceLabel(fact.confidence))}</small></div><p>${escapeHtml(fact.evidence)}</p></article>`).join(\"\") : \"<p>Nenhuma evidência estruturada foi retornada.</p>\"}</div>`;\n\n  const questions = carousel.questions || {};\n  const analysisHolder = document.getElementById(\"carouselAnalysis\");\n  analysisHolder.hidden = false;\n  analysisHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Interpretação da notícia</p><h3>Respostas editoriais</h3></div></div><div class=\"question-grid\">${questionCard(\"O que aconteceu?\", questions.whatHappened)}${questionCard(\"Quem está envolvido?\", questions.who)}${questionCard(\"Onde aconteceu?\", questions.where)}${questionCard(\"Quando aconteceu?\", questions.when)}${questionCard(\"Qual o impacto?\", questions.impact)}${questionCard(\"Qual a repercussão?\", questions.repercussion)}</div>`;\n\n  const entities = carousel.entities || {};\n  const entityHolder = document.getElementById(\"carouselEntities\");\n  entityHolder.hidden = false;\n  entityHolder.innerHTML = `<div class=\"carousel-section-head\"><div><p class=\"eyebrow\">Estrutura de dados</p><h3>Elementos extraídos</h3></div></div><div class=\"entity-grid\">${entityGroup(\"Personagens\", entities.people)}${entityGroup(\"Empresas\", entities.companies)}${entityGroup(\"Locais\", entities.places)}${entityGroup(\"Datas\", entities.dates)}${entityGroup(\"Temas\", entities.themes)}${entityGroup(\"Palavras-chave\", entities.keywords)}</div>`;\n\n  document.getElementById(\"carouselSlides\").innerHTML = (state.activeCarousel.slides || []).map(slideEditorMarkup).join(\"\");\n  const verificationLinks = Array.isArray(carousel.verificationLinks) ? carousel.verificationLinks : topicVerificationLinks(topic);\n  const readingSources = new Map();\n  for (const item of reading.sources || []) {\n    const urls = [item?.url, item?.originalUrl, item?.extractionUrl]\n      .filter((url) => /^https?:\\/\\//i.test(String(url || \"\")))\n      .map(safeUrl);\n    urls.forEach((url) => readingSources.set(url, item));\n  }\n  document.getElementById(\"carouselSources\").innerHTML = `<div class=\"carousel-sources-head\"><div><p class=\"eyebrow\">Apuração obrigatória</p><h3>Matéria utilizada e links adicionais</h3></div><span>${verificationLinks.length} ${verificationLinks.length === 1 ? \"notícia\" : \"notícias\"}</span></div><div class=\"carousel-source-list\">${verificationLinks.map((link) => {\n    const source = readingSources.get(safeUrl(link.url));\n    const direct = /^full-article/.test(source?.readMode || \"\");\n    const level = direct ? \"Matéria lida\" : source?.contentLevel === \"content\" ? \"Fallback · texto do feed\" : source?.contentLevel === \"summary\" ? \"Fallback · resumo do feed\" : source ? \"Fallback · somente título\" : \"Link adicional\";\n    const status = source ? `${level} · ${Number(source.wordCount) || 0} palavras${source.liveReadError ? ` · ${source.liveReadError}` : \"\"}` : \"Link adicional para apuração\";\n    const sourceClass = direct ? \"read-ok\" : source ? \"read-fallback\" : \"\";\n    return `<a class=\"carousel-source-link ${sourceClass}\" href=\"${escapeHtml(safeUrl(link.url))}\" target=\"_blank\" rel=\"noreferrer\"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}${link.publishedAt ? ` · ${escapeHtml(formatDate(link.publishedAt))}` : \"\"}</small><small class=\"read-status\">${escapeHtml(status)}</small></span><em>Abrir para apuração ↗</em></a>`;\n  }).join(\"\")}</div>`;\n  document.getElementById(\"carouselDisclaimer\").textContent = carousel.disclaimer || \"Revise e confirme as informações antes de publicar.\";\n  const gate = carousel.editorialGate || {};\n  const validation = carousel.validation || {};\n  const messages = [];\n  if (cycleReleased) messages.push(\"Ciclo encerrado e sistema liberado para uma nova leitura.\");\n  if (carousel.aiError) messages.push(`A IA falhou e foi usado o modo de contingência: ${carousel.aiError}`);\n  if (!gate.copyAllowed) messages.push(gate.reason || \"A cópia foi bloqueada até a revisão editorial.\");\n  if (validation.correctedSlides?.length) messages.push(`Validador corrigiu os slides: ${validation.correctedSlides.join(\", \")}.`);\n  document.getElementById(\"copyCarouselMessage\").textContent = messages.join(\" \");\n  state.carouselText = carouselAsText(topic, state.activeCarousel);\n  document.getElementById(\"copyCarousel\").disabled = !gate.copyAllowed || !cycleReleased;\n}\n\nasync function showCarousel(topicId, { force = false } = {}) {\n  const topic = (state.data?.topics || []).find((item) => item.id === topicId);\n  if (!topic) {\n    setStatus(\"warn\", \"Assunto indisponível\", \"Atualize a ronda e tente novamente.\");\n    return;\n  }\n  const requestSerial = state.carouselRequestSerial + 1;\n  state.carouselRequestSerial = requestSerial;\n  state.activeTopicId = topicId;\n  document.getElementById(\"carouselTitle\").textContent = topic.title;\n  document.getElementById(\"carouselMeta\").innerHTML = \"\";\n  document.getElementById(\"carouselReading\").hidden = true;\n  document.getElementById(\"carouselEvidence\").hidden = true;\n  document.getElementById(\"carouselAnalysis\").hidden = true;\n  document.getElementById(\"carouselEntities\").hidden = true;\n  document.getElementById(\"carouselSlides\").innerHTML = \"\";\n  document.getElementById(\"carouselSources\").innerHTML = \"\";\n  document.getElementById(\"carouselDisclaimer\").textContent = \"\";\n  document.getElementById(\"copyCarouselMessage\").textContent = \"\";\n  state.carouselText = \"\";\n  state.activeCarousel = null;\n  openModal(\"carouselModal\");\n\n  const key = carouselCacheKey(topicId);\n  const cached = !force ? state.smartCarousels.get(key) : null;\n  if (cached) {\n    renderIntelligentCarousel(topic, cached);\n    return;\n  }\n  setCarouselLoading(true, \"Selecionando uma única matéria e preparando o roteiro.\", { progress: 1 });\n  const token = operationToken();\n  try {\n    const response = await api(`/api/topics/${encodeURIComponent(topicId)}/intelligent-carousel`, {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\", ...(token ? { \"X-Round-Token\": token } : {}) },\n      body: JSON.stringify({ runId: state.data?.runId || state.lastRunId || null, force }),\n    });\n    if (requestSerial !== state.carouselRequestSerial) return;\n    let data = response?.data;\n    if (!data?.slides?.length && response?.job?.jobId) {\n      setCarouselJobProgress(response.job);\n      data = await waitForIntelligentJob(response.job.jobId, requestSerial, response.pollAfterMs);\n    }\n    if (requestSerial !== state.carouselRequestSerial || !data) return;\n    if (!data.slides?.length) throw new Error(\"O servidor não retornou os sete slides esperados.\");\n    state.smartCarousels.set(key, data);\n    renderIntelligentCarousel(topic, data);\n  } catch (error) {\n    if (requestSerial !== state.carouselRequestSerial) return;\n    if (error.status === 401) {\n      document.getElementById(\"tokenMessage\").textContent = \"Informe a chave do Worker para usar a leitura inteligente.\";\n    }\n    setCarouselLoading(false, error.message, { retry: true });\n    document.getElementById(\"carouselSources\").innerHTML = `<div class=\"carousel-sources-head\"><div><p class=\"eyebrow\">Apuração manual</p><h3>Abra as notícias originais</h3></div></div><div class=\"carousel-source-list\">${topicVerificationLinks(topic).map((link) => `<a class=\"carousel-source-link\" href=\"${escapeHtml(link.url)}\" target=\"_blank\" rel=\"noreferrer\"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}</small></span><em>Abrir para apuração ↗</em></a>`).join(\"\")}</div>`;\n  }\n}\n\nasync function copyCarouselText() {\n  const message = document.getElementById(\"copyCarouselMessage\");\n  try {\n    await navigator.clipboard.writeText(state.carouselText);\n    message.textContent = \"Roteiro copiado.\";\n  } catch {\n    const area = document.createElement(\"textarea\");\n    area.value = state.carouselText;\n    area.setAttribute(\"readonly\", \"\");\n    area.style.position = \"fixed\";\n    area.style.opacity = \"0\";\n    document.body.appendChild(area);\n    area.select();\n    const copied = document.execCommand(\"copy\");\n    area.remove();\n    message.textContent = copied ? \"Roteiro copiado.\" : \"Não foi possível copiar automaticamente.\";\n  }\n}\n\nasync function startApplication() {\n  render();\n  document.getElementById(\"operationToken\").value = operationToken();\n  const healthy = await checkHealth();\n  if (!healthy) return;\n  const latest = await loadLatest();\n  if (!latest && (!state.health.manualAuthRequired || operationToken())) executeRound(true);\n}\n\nrunButton.addEventListener(\"click\", () => executeRound(false));\ndocument.getElementById(\"searchInput\").addEventListener(\"input\", (event) => { state.query = event.target.value; render(); });\ndocument.getElementById(\"periodFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.period = Number(event.target.dataset.value);\n  event.currentTarget.querySelectorAll(\"button\").forEach((button) => button.classList.toggle(\"active\", button === event.target));\n  render();\n});\ndocument.getElementById(\"sourceFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.portal = null;\n  setSourceSegment(event.target.dataset.value);\n  state.expanded.clear();\n  renderSourceHealth();\n  render();\n});\ndocument.getElementById(\"regionFilter\").addEventListener(\"click\", (event) => {\n  if (!event.target.matches(\"button\")) return;\n  state.portal = null;\n  setRegionSegment(event.target.dataset.value);\n  state.expanded.clear();\n  renderSourceHealth();\n  render();\n});\ndocument.getElementById(\"editoriaFilter\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-editoria]\");\n  if (!button) return;\n  state.editoria = button.dataset.editoria;\n  event.currentTarget.querySelectorAll(\"[data-editoria]\").forEach((item) => item.classList.toggle(\"active\", item === button));\n  state.expanded.clear();\n  render();\n});\ndocument.getElementById(\"topicsGrid\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-carousel-topic]\");\n  if (button) showCarousel(button.dataset.carouselTopic);\n});\ndocument.getElementById(\"copyCarousel\").addEventListener(\"click\", copyCarouselText);\ndocument.getElementById(\"carouselSlides\").addEventListener(\"input\", (event) => {\n  if (event.target.matches(\"[data-slide-title], [data-slide-subtitle]\")) updateEditedSlide(event.target);\n});\ndocument.getElementById(\"carouselLoading\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-retry-carousel]\");\n  if (button && state.activeTopicId) showCarousel(state.activeTopicId, { force: true });\n});\ndocument.getElementById(\"customSourceForm\").addEventListener(\"submit\", submitCustomSource);\ndocument.getElementById(\"customSourcesList\").addEventListener(\"click\", (event) => {\n  const toggle = event.target.closest(\"[data-custom-toggle]\");\n  const remove = event.target.closest(\"[data-custom-delete]\");\n  if (toggle) changeCustomSource(toggle.dataset.customToggle, { active: toggle.dataset.nextActive === \"true\" });\n  if (remove) changeCustomSource(remove.dataset.customDelete, { delete: true });\n});\ndocument.getElementById(\"monitoringTermForm\").addEventListener(\"submit\", submitMonitoringTerm);\ndocument.getElementById(\"monitoringTermsList\").addEventListener(\"click\", (event) => {\n  const toggle = event.target.closest(\"[data-term-toggle]\");\n  const remove = event.target.closest(\"[data-term-delete]\");\n  if (toggle) changeMonitoringTerm(toggle.dataset.termToggle, { active: toggle.dataset.nextActive === \"true\" });\n  if (remove) changeMonitoringTerm(remove.dataset.termDelete, { delete: true });\n});\ndocument.getElementById(\"monitoringTermFilters\").addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-monitoring-filter]\");\n  if (!button) return;\n  state.monitoringTermFilter = button.dataset.monitoringFilter;\n  renderDedicatedMonitoring();\n});\ndocument.getElementById(\"settingsButton\").addEventListener(\"click\", () => openModal(\"settingsModal\"));\ndocument.getElementById(\"openSettings\").addEventListener(\"click\", () => openModal(\"settingsModal\"));\ndocument.getElementById(\"navHistory\").addEventListener(\"click\", showHistory);\ndocument.getElementById(\"historyList\").addEventListener(\"click\", (event) => {\n  const row = event.target.closest(\"[data-history-run]\");\n  if (row && !row.disabled) showHistoryDetail(row.dataset.historyRun);\n});\ndocument.getElementById(\"historyBack\").addEventListener(\"click\", () => {\n  document.getElementById(\"historyDetail\").hidden = true;\n  document.getElementById(\"historyList\").hidden = false;\n  document.getElementById(\"historyBack\").hidden = true;\n});\ndocument.getElementById(\"navSources\").addEventListener(\"click\", () => { showView(\"sources\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"navCustomSources\").addEventListener(\"click\", () => { showView(\"custom-sources\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"navMonitoring\").addEventListener(\"click\", () => { showView(\"monitoring\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"navRound\").addEventListener(\"click\", () => { showView(\"round\"); document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }); });\ndocument.getElementById(\"goTop\").addEventListener(\"click\", () => document.getElementById(\"workspaceTop\").scrollIntoView({ behavior: \"smooth\" }));\ndocument.getElementById(\"showAllSources\").addEventListener(\"click\", () => filterByPortal(null));\ndocument.getElementById(\"clearPortalFilter\").addEventListener(\"click\", () => filterByPortal(null));\ndocument.addEventListener(\"click\", (event) => {\n  const button = event.target.closest(\"[data-portal]\");\n  if (!button) return;\n  filterByPortal(button.dataset.portal);\n});\ndocument.getElementById(\"saveSettings\").addEventListener(\"click\", () => {\n  const token = document.getElementById(\"operationToken\").value.trim();\n  try { token ? localStorage.setItem(STORAGE_TOKEN, token) : localStorage.removeItem(STORAGE_TOKEN); } catch {}\n  document.getElementById(\"tokenMessage\").textContent = \"\";\n  closeModal(\"settingsModal\");\n});\ndocument.querySelectorAll(\"[data-close]\").forEach((button) => button.addEventListener(\"click\", () => closeModal(button.dataset.close)));\ndocument.querySelectorAll(\".modal-backdrop\").forEach((backdrop) => backdrop.addEventListener(\"click\", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));\ndocument.addEventListener(\"keydown\", (event) => { if (event.key === \"Escape\") document.querySelectorAll(\".modal-backdrop:not([hidden])\").forEach((modal) => closeModal(modal.id)); });\n\nsetInterval(async () => {\n  if (state.running || !state.health) return;\n  await checkHealth();\n  await loadLatest({ quiet: true });\n}, 30_000);\n\nstartApplication();\n"}});

return { "UI_ASSETS": UI_ASSETS };
})();

const __module_src_index_js = (() => {
const { buildCarouselBrief, buildTopics, classifyEditoria } = __module_src_clustering_js;
const { ARTICLE_ANALYSIS_MODEL, buildIntelligentCarousel, extractArticleFromHtml, intelligentCarouselCacheKey, validateArticleUrl } = __module_src_article_reader_js;
const { collectRound, customSourceFeed, FEEDS } = __module_src_collector_js;
const { acquireLock,
  createCustomSource,
  createIntelligentJob,
  createMonitoringTerm,
  databaseHealth,
  databaseSelfTest,
  deleteCustomSource,
  deleteMonitoringTerm,
  ensureSchema,
  getArticleReadCache,
  getArticleSourceStats,
  getIntelligentCarousel,
  getIntelligentJob,
  getLatestRound,
  getRunHistory,
  getRunPayload,
  getRunStatus,
  listCustomSources,
  listMonitoringTerms,
  MAX_CUSTOM_SOURCES,
  MAX_MONITORING_TERMS,
  recordArticleSourceAttempt,
  releaseLock,
  saveArticleReadCache,
  saveIntelligentCarousel,
  saveRun,
  setCustomSourceActive,
  setMonitoringTermActive,
  startRun,
  updateIntelligentJob, } = __module_src_database_js;
const { parseFeed, plainText } = __module_src_parser_js;
const { portugueseOnlyFallback, TRANSLATION_MODEL, translateRoundPayload } = __module_src_translation_js;
const { UI_ASSETS } = __module_src_ui_generated_js;








const VERSION = "2.4.3";
const INTELLIGENT_JOB_STALE_LABEL = "10 minutos";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extraHeaders } });
}

function assetResponse(asset) {
  return new Response(asset.body, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": asset.contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Ronda-Version": VERSION,
    },
  });
}

function secureEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ""));
  const b = new TextEncoder().encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function requireOperationAuth(request, env) {
  if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
    throw new HttpError(401, "Chave de operação inválida.");
  }
}

function validatedCustomSource(body) {
  const name = plainText(body?.name).slice(0, 80);
  if (name.length < 2) throw new HttpError(400, "Informe um nome com pelo menos dois caracteres.");
  let url;
  try {
    url = validateArticleUrl(body?.url);
  } catch {
    throw new HttpError(400, "Informe uma URL pública válida, começando com http:// ou https://.");
  }
  const region = body?.region === "Mundo" ? "Mundo" : "Brasil";
  return { name, url, region };
}

function validatedMonitoringTerm(body) {
  const term = plainText(body?.term).replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2) throw new HttpError(400, "Informe um termo com pelo menos dois caracteres.");
  return term;
}

function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "Banco D1 não configurado.", "Crie um banco D1 e adicione ao Worker um binding chamado DB.");
  return env.DB;
}

function withEditorias(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.topics)) return payload;
  const safePayload = payload.translation?.targetLanguage === "pt-BR" && payload.translation?.portugueseOnly
    ? payload
    : portugueseOnlyFallback(payload);
  return {
    ...safePayload,
    topics: safePayload.topics.map((topic) => {
      const recalculatedEditoria = classifyEditoria(topic?.items || []);
      const editoriaChanged = topic?.editoria !== recalculatedEditoria;
      const enriched = { ...topic, editoria: recalculatedEditoria };
      const expectedUrls = new Set((enriched?.items || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselUrls = new Set((enriched?.carousel?.verificationLinks || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselHasEveryLink = expectedUrls.size > 0 && [...expectedUrls].every((url) => carouselUrls.has(url));
      return enriched?.carousel?.slides?.length && carouselHasEveryLink && !editoriaChanged
        ? enriched
        : { ...enriched, carousel: buildCarouselBrief(enriched) };
    }),
  };
}

function translationAi(env) {
  if (env.AI?.run) return env.AI;
  if (env.ENVIRONMENT === "test" && env.TRANSLATION_TEST_MODE === "1") {
    return { run: async (_model, input) => ({ translated_text: String(input?.text || "") }) };
  }
  return null;
}

function articleAnalysisAi(env) {
  if (env.AI?.run) return env.AI;
  if (env.ENVIRONMENT === "test" && env.ARTICLE_ANALYSIS_TEST_MODE === "1") {
    return {
      run: async () => ({
        response: {
          questions: {
            whatHappened: "O Congresso aprovou um plano nacional de mobilidade urbana.",
            who: "Congresso Nacional e órgãos públicos responsáveis pela mobilidade.",
            where: "Brasil.",
            when: "Na data informada pela matéria selecionada.",
            impact: "A medida pode orientar investimentos e mudanças na mobilidade urbana.",
            repercussion: "Profissionais do setor e administrações locais pedem clareza sobre os próximos passos.",
          },
          entities: {
            people: [],
            companies: ["Congresso Nacional"],
            places: ["Brasil"],
            dates: [],
            themes: ["mobilidade urbana", "política pública"],
            keywords: ["mobilidade", "Congresso", "investimentos"],
          },
          facts: [
            {
              claim: "O Congresso aprovou um novo plano nacional de mobilidade urbana.",
              evidence: "O Congresso aprovou um novo plano nacional de mobilidade urbana",
              confidence: "high",
            },
            {
              claim: "A implantação deverá ocorrer em etapas.",
              evidence: "A implantação deverá ocorrer em etapas",
              confidence: "high",
            },
          ],
          slides: [
            { number: 1, role: "Título principal", title: "Congresso aprova plano de mobilidade", body: "A proposta define novas diretrizes para o setor.", evidenceIds: ["fact-1"] },
            { number: 2, role: "Contexto", title: "O que orienta o plano", body: "O texto trata de transporte público, ciclovias, acessibilidade e segurança viária.", evidenceIds: ["fact-1"] },
            { number: 3, role: "Informação principal", title: "A medida foi aprovada", body: "O Congresso aprovou o novo plano nacional de mobilidade urbana.", evidenceIds: ["fact-1"] },
            { number: 4, role: "Detalhamento", title: "Aplicação em etapas", body: "A implantação deverá ocorrer em etapas e ainda depende de detalhamento técnico.", evidenceIds: ["fact-2"] },
            { number: 5, role: "Consequência", title: "Recursos podem mudar", body: "A medida pode influenciar a distribuição de recursos e a escolha de obras.", evidenceIds: ["fact-1"] },
            { number: 6, role: "Conclusão", title: "Próximos passos", body: "Prazos, financiamento e regras complementares ainda precisam ser detalhados.", evidenceIds: ["fact-2"] },
            { number: 7, role: "CTA", title: "Acompanhe a pauta", body: "Consulte a matéria original e acompanhe as próximas atualizações.", evidenceIds: ["fact-2"] },
          ],
        },
      }),
    };
  }
  return null;
}


function publicIntelligentJob(job) {
  const terminal = ["succeeded", "failed"].includes(job.status);
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    stale: Boolean(job.stale),
    terminal,
    released: terminal,
    nextCycleAllowed: terminal,
  };
}

async function processIntelligentCarouselJob(env, job, topic) {
  const db = requireDatabase(env);
  const jobLock = await acquireLock(db, `intelligent-job-${job.jobId}`, 4 * 60 * 1000);
  if (!jobLock) return null;
  try {
    const started = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "running",
      progress: 4,
      message: "Selecionando uma única matéria para esta sugestão.",
    });
    if (!started) throw new Error("A tarefa de leitura não foi encontrada para iniciar o ciclo.");
    let sourceStats = {};
    try {
      sourceStats = await getArticleSourceStats(
        db,
        (topic?.items || []).map((item) => item?.url).filter(Boolean),
      );
    } catch (error) {
      console.error("Histórico de leitura indisponível; seleção seguirá sem esse sinal", error);
    }
    const data = await buildIntelligentCarousel(topic, {
      ai: articleAnalysisAi(env),
      model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      fetcher: fetch,
      liveReading: env.ARTICLE_LIVE_READING !== "0",
      sourceStats,
      readCache: {
        get: (cacheKey) => getArticleReadCache(db, cacheKey),
        set: (cacheKey, payload) => saveArticleReadCache(db, cacheKey, payload, 12),
      },
      onProgress: async ({ progress, message }) => {
        await updateIntelligentJob(db, {
          jobId: job.jobId,
          status: "running",
          progress,
          message,
        });
      },
    });
    const selectedSource = data?.reading?.selectedSource;
    if (selectedSource?.liveAttempted) {
      try {
        await recordArticleSourceAttempt(db, {
          url: selectedSource.url,
          success: selectedSource.readMode === "full-article",
          wordCount: selectedSource.wordCount,
        });
      } catch (error) {
        console.error("Não foi possível atualizar a estatística do portal", error);
      }
    }
    const releasedAt = new Date().toISOString();
    const storedData = {
      ...data,
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      topicTitle: topic.title,
      cycle: {
        ...(data.cycle || {}),
        status: "completed",
        terminal: true,
        released: true,
        releasedAt,
        nextCycleAllowed: true,
        jobId: job.jobId,
      },
    };
    await saveIntelligentCarousel(db, {
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      payload: storedData,
      ttlHours: 48,
    });
    const completed = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "succeeded",
      progress: 100,
      message: "Roteiro concluído. Ciclo encerrado e sistema disponível para a próxima sugestão.",
      payload: storedData,
    });
    if (completed?.status !== "succeeded") throw new Error("Não foi possível registrar o encerramento do ciclo.");
    return storedData;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failed = await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "failed",
      progress: 100,
      message: "Ciclo encerrado após falha. Sistema liberado para uma nova leitura.",
      error: detail,
    });
    if (failed?.status !== "failed") throw error;
    console.error("Leitura inteligente falhou", detail);
    return null;
  } finally {
    try { await releaseLock(db, jobLock); } catch (error) {
      console.error("Não foi possível remover o lock terminal da leitura", error);
    }
  }
}


async function resolveTopicForIntelligentJob(env, job) {
  const db = requireDatabase(env);
  let payload;
  if (job.runId && job.runId !== "latest") {
    const stored = await getRunPayload(db, job.runId);
    if (!stored?.payload) throw new Error("A ronda vinculada a esta tarefa não está mais disponível.");
    payload = withEditorias({
      ...stored.payload,
      runId: stored.id,
      triggerType: stored.triggerType,
      storedAt: stored.completedAt,
    });
  } else {
    payload = withEditorias(await getLatestRound(db));
  }
  if (!payload?.ok || !Array.isArray(payload.topics)) throw new Error("Não há uma ronda válida para processar esta tarefa.");
  const topic = payload.topics.find((item) => item?.id === job.topicId);
  if (!topic) throw new Error("O assunto da tarefa não foi encontrado na ronda armazenada.");
  return topic;
}

async function processIntelligentQueueBatch(batch, env) {
  for (const message of batch.messages || []) {
    const body = message?.body && typeof message.body === "object" ? message.body : {};
    const jobId = String(body.jobId || "").trim();
    if (!jobId) {
      message?.ack?.();
      continue;
    }
    try {
      const db = requireDatabase(env);
      const job = await getIntelligentJob(db, jobId);
      if (!job || ["succeeded", "failed"].includes(job.status)) {
        message?.ack?.();
        continue;
      }
      const topic = await resolveTopicForIntelligentJob(env, job);
      await processIntelligentCarouselJob(env, job, topic);
      message?.ack?.();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Consumidor da fila de leitura inteligente falhou", detail);
      let terminalRecorded = false;
      try {
        const failed = await updateIntelligentJob(requireDatabase(env), {
          jobId,
          status: "failed",
          progress: 100,
          message: "Ciclo encerrado no consumidor. Sistema liberado para uma nova leitura.",
          error: detail,
        });
        terminalRecorded = failed?.status === "failed";
      } catch {}
      if (terminalRecorded) message?.ack?.();
      else if (Number(message?.attempts || 1) < 3 && message?.retry) message.retry({ delaySeconds: 5 });
      else message?.ack?.();
    }
  }
}

async function performRound(env, triggerType, options = {}) {
  const db = requireDatabase(env);
  await ensureSchema(db);
  const lock = options.lock || await acquireLock(db, "editorial-round", 3 * 60 * 1000);
  if (!lock) throw new HttpError(409, "Já existe uma ronda em andamento.");

  const runId = options.runId || crypto.randomUUID();
  const startedAt = options.startedAt || new Date().toISOString();
  try {
    if (!options.runStarted) await startRun(db, { id: runId, triggerType, startedAt });
    let payload;
    try {
      const [customSources, monitoringTerms, previousRound] = await Promise.all([
        listCustomSources(db, { activeOnly: true }),
        listMonitoringTerms(db, { activeOnly: true }),
        getLatestRound(db).catch(() => null),
      ]);
      payload = await collectRound({
        feeds: [...FEEDS, ...customSources.map(customSourceFeed)],
        monitoringTerms,
        previousRound,
      });
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("O coletor não retornou um resultado válido.");
      }
      payload.configuration = {
        customSources: customSources.map((source) => ({
          id: source.id,
          name: source.name,
          region: source.region,
          url: source.url,
        })),
        monitoringTerms: monitoringTerms.map((term) => ({ id: term.id, term: term.term })),
        browserRequired: false,
        execution: "cloudflare-cron",
      };
      try {
        payload = await translateRoundPayload(payload, { ai: translationAi(env), db });
      } catch (error) {
        console.error("Tradução da ronda falhou", error);
        payload = portugueseOnlyFallback(payload);
      }
    } catch (error) {
      payload = {
        ok: false,
        collectedAt: new Date().toISOString(),
        windowHours: 24,
        durationMs: Date.now() - Date.parse(startedAt),
        error: "A coleta foi interrompida por um erro interno.",
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        sources: [],
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0, dedicatedItems: 0 },
        items: [],
        topics: [],
        dedicatedMonitoring: {
          enabled: false,
          terms: [],
          items: [],
          statuses: [],
          totals: { terms: 0, items: 0, sources: 0 },
        },
      };
    }
    await saveRun(db, { id: runId, triggerType, startedAt, payload });
    const storedPayload = { ...payload, runId, triggerType };
    if (!payload.ok) throw new HttpError(503, payload.error, payload.detail || null);
    return storedPayload;
  } finally {
    await releaseLock(db, lock);
  }
}

async function selfTest() {
  const now = new Date();
  const published = now.toUTCString();
  const fixture = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Prefeitura anuncia plano de mobilidade urbana</title><link>https://example.test/a</link><pubDate>${published}</pubDate><description>Teste A</description></item>
    <item><title>Plano de mobilidade urbana é anunciado pela prefeitura</title><link>https://example.test/b</link><pubDate>${published}</pubDate><description>Teste B</description></item>
  </channel></rss>`;
  const items = parseFeed(fixture, { id: "test", name: "Teste" }, new Date(now.getTime() - 86_400_000));
  const topics = buildTopics(items, now);
  const article = extractArticleFromHtml(`<html><body><nav>Menu principal</nav><div class="publicidade">Compre agora</div><article><h1>Plano de mobilidade</h1><p>A prefeitura apresentou um plano de mobilidade urbana para melhorar o transporte público e reorganizar os deslocamentos na cidade.</p><p>O projeto prevê corredores de ônibus, integração tarifária, novas ciclovias e revisão das linhas que atendem os bairros mais afastados.</p><p>Segundo a administração municipal, a implantação será feita em etapas e dependerá de estudos técnicos, recursos orçamentários e audiências públicas.</p></article></body></html>`, { title: "Plano de mobilidade" });
  const articleOk = article.wordCount >= 45 && !article.content.includes("Compre agora") && !article.content.includes("Menu principal");
  return {
    ok: items.length === 2 && topics.length === 1 && topics[0].itemCount === 2 && articleOk,
    parserItems: items.length,
    groupedTopics: topics.length,
    cardItems: topics[0]?.itemCount ?? 0,
    articleWords: article.wordCount,
    articleNoiseRemoved: articleOk,
  };
}

async function handleApi(request, env, url, ctx) {
  if (url.pathname === "/api/self-test" && request.method === "GET") {
    const logic = await selfTest();
    const db = requireDatabase(env);
    const databaseOk = await databaseSelfTest(db);
    const result = {
      ...logic,
      ok: logic.ok && databaseOk,
      database: { configured: true, readWriteDelete: databaseOk },
    };
    return json(result, result.ok ? 200 : 500);
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    const db = requireDatabase(env);
    const dbOk = await databaseHealth(db);
    const latest = await getLatestRound(db);
    const [customSources, monitoringTerms] = await Promise.all([
      listCustomSources(db, { activeOnly: true }),
      listMonitoringTerms(db, { activeOnly: true }),
    ]);
    const lastSuccessAt = latest?.collectedAt ?? null;
    const ageMs = lastSuccessAt ? Date.now() - Date.parse(lastSuccessAt) : Number.POSITIVE_INFINITY;
    return json({
      ok: dbOk,
      ready: dbOk,
      service: "ronda-editorial-webapp",
      version: VERSION,
      database: dbOk ? "connected" : "error",
      scheduleMinutes: 5,
      schedulerHealthy: ageMs <= 12 * 60 * 1000,
      lastSuccessAt,
      lastRunId: latest?.runId ?? null,
      manualAuthRequired: Boolean(env.MANUAL_ROUND_TOKEN),
      backgroundMonitoring: {
        active: true,
        browserRequired: false,
        execution: "cloudflare-cron",
        scheduleMinutes: 5,
        customSources: customSources.length,
        monitoringTerms: monitoringTerms.length,
        dedicatedResults: Number(latest?.dedicatedMonitoring?.items?.length) || 0,
        catalogPortals: FEEDS.length,
        catalogBrazil: FEEDS.filter((feed) => feed.region === "Brasil").length,
        catalogWorld: FEEDS.filter((feed) => feed.region === "Mundo").length,
      },
      portalCollection: {
        strategy: "official-feed-shared-google-fallback-cache",
        sharedFallbackQueries: true,
        sourceDomainMatching: true,
        lastKnownGoodCache: true,
        cacheWindowHours: 24,
        statusModes: ["direct", "fallback", "cache", "failed"],
      },
      editorialClassification: {
        specializedCategories: [
          "Fofoca e Celebridades",
          "Reality Shows",
          "Curiosidades e Ciência Pop",
          "Conteúdo Viral e Redes Sociais",
          "Luto e Obituário",
          "Segurança e Justiça",
        ],
        deathOutsideEntertainment: true,
        violentDeathCategory: "Segurança e Justiça",
        obituaryCategory: "Luto e Obituário",
      },
      translation: {
        ready: Boolean(translationAi(env)?.run),
        targetLanguage: "pt-BR",
        model: TRANSLATION_MODEL,
      },
      intelligentReading: {
        ready: true,
        aiReady: Boolean(articleAnalysisAi(env)?.run),
        mode: "single-article-with-feed-fallback",
        asynchronousJobs: true,
        queueReady: Boolean(env.INTELLIGENT_JOBS_QUEUE?.send),
        executionMode: env.INTELLIGENT_JOBS_QUEUE?.send ? "cloudflare-queue" : "request-fallback",
        articleLimit: 1,
        readingStrategy: "single-best-source-with-history",
        cycleMode: "one-article-one-script",
        cycleFinalization: "terminal-and-released",
        nextCycleAfterTerminal: true,
        factPipeline: "evidence-map-then-carousel",
        editorialQualityGate: true,
        articleReadCacheHours: 12,
        perSourceTimeoutSeconds: 10,
        readingConcurrency: 1,
        model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      },
    });
  }

  if (url.pathname === "/api/custom-sources" && request.method === "GET") {
    const sources = await listCustomSources(requireDatabase(env));
    return json({
      ok: true,
      sources,
      limits: {
        maximumActive: MAX_CUSTOM_SOURCES,
        active: sources.filter((source) => source.active).length,
      },
    });
  }

  if (url.pathname === "/api/custom-sources" && request.method === "POST") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const input = validatedCustomSource(body);
    try {
      const source = await createCustomSource(requireDatabase(env), input);
      return json({ ok: true, source }, 201);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível cadastrar o site.");
    }
  }

  const customSourceRoute = /^\/api\/custom-sources\/([a-z0-9-]{8,80})$/i.exec(url.pathname);
  if (customSourceRoute && request.method === "PATCH") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    if (typeof body?.active !== "boolean") throw new HttpError(400, "Informe se o site deve ficar ativo.");
    try {
      const source = await setCustomSourceActive(requireDatabase(env), customSourceRoute[1], body.active);
      if (!source) throw new HttpError(404, "Site cadastrado não encontrado.");
      return json({ ok: true, source });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível atualizar o site.");
    }
  }
  if (customSourceRoute && request.method === "DELETE") {
    requireOperationAuth(request, env);
    const source = await deleteCustomSource(requireDatabase(env), customSourceRoute[1]);
    if (!source) throw new HttpError(404, "Site cadastrado não encontrado.");
    return json({ ok: true, deleted: source });
  }

  if (url.pathname === "/api/monitoring-terms" && request.method === "GET") {
    const terms = await listMonitoringTerms(requireDatabase(env));
    return json({
      ok: true,
      terms,
      limits: {
        maximumActive: MAX_MONITORING_TERMS,
        active: terms.filter((term) => term.active).length,
      },
    });
  }

  if (url.pathname === "/api/monitoring-terms" && request.method === "POST") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const termValue = validatedMonitoringTerm(body);
    try {
      const term = await createMonitoringTerm(requireDatabase(env), termValue);
      return json({ ok: true, term }, 201);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível cadastrar o termo.");
    }
  }

  const monitoringTermRoute = /^\/api\/monitoring-terms\/([a-z0-9-]{8,80})$/i.exec(url.pathname);
  if (monitoringTermRoute && request.method === "PATCH") {
    requireOperationAuth(request, env);
    const body = await request.json().catch(() => ({}));
    if (typeof body?.active !== "boolean") throw new HttpError(400, "Informe se o termo deve ficar ativo.");
    try {
      const term = await setMonitoringTermActive(requireDatabase(env), monitoringTermRoute[1], body.active);
      if (!term) throw new HttpError(404, "Termo de monitoramento não encontrado.");
      return json({ ok: true, term });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, error instanceof Error ? error.message : "Não foi possível atualizar o termo.");
    }
  }
  if (monitoringTermRoute && request.method === "DELETE") {
    requireOperationAuth(request, env);
    const term = await deleteMonitoringTerm(requireDatabase(env), monitoringTermRoute[1]);
    if (!term) throw new HttpError(404, "Termo de monitoramento não encontrado.");
    return json({ ok: true, deleted: term });
  }

  if (url.pathname === "/api/latest" && request.method === "GET") {
    const latest = await getLatestRound(requireDatabase(env));
    return json({ ok: true, data: withEditorias(latest) });
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    const runs = await getRunHistory(requireDatabase(env), url.searchParams.get("limit"));
    return json({ ok: true, runs });
  }

  const runRoute = /^\/api\/runs\/([a-z0-9-]{8,80})(\/data)?$/i.exec(url.pathname);
  if (runRoute && request.method === "GET") {
    const runId = runRoute[1];
    if (runRoute[2]) {
      const stored = await getRunPayload(requireDatabase(env), runId);
      if (!stored) throw new HttpError(404, "Ronda não encontrada.");
      if (!stored.payload) throw new HttpError(409, "Esta ronda ainda não possui notícias disponíveis.");
      return json({
        ok: true,
        run: {
          id: stored.id,
          triggerType: stored.triggerType,
          status: stored.status,
          startedAt: stored.startedAt,
          completedAt: stored.completedAt,
          error: stored.error,
        },
        data: withEditorias({ ...stored.payload, runId: stored.id, triggerType: stored.triggerType, storedAt: stored.completedAt }),
      });
    }
    const run = await getRunStatus(requireDatabase(env), runId);
    if (!run) throw new HttpError(404, "Ronda ainda não encontrada.");
    return json({ ok: true, run });
  }

  const intelligentJobRoute = /^\/api\/intelligent-jobs\/([a-z0-9-]{16,80})$/i.exec(url.pathname);
  if (intelligentJobRoute && request.method === "GET") {
    const db = requireDatabase(env);
    let job = await getIntelligentJob(db, intelligentJobRoute[1]);
    if (!job) throw new HttpError(404, "Processamento não encontrado ou expirado.");
    if (job.stale && ["queued", "running"].includes(job.status)) {
      job = await updateIntelligentJob(db, {
        jobId: job.jobId,
        status: "failed",
        progress: 100,
        message: "O processamento foi interrompido e pode ser reiniciado.",
        error: `A tarefa ficou sem atualização por mais de ${INTELLIGENT_JOB_STALE_LABEL}.`,
      });
    }
    return json({
      ok: true,
      job: publicIntelligentJob(job),
      ...(job.status === "succeeded" && job.payload ? { data: job.payload } : {}),
    });
  }

  const intelligentCarouselRoute = /^\/api\/topics\/([a-z0-9-]{6,100})\/intelligent-carousel$/i.exec(url.pathname);
  if (intelligentCarouselRoute && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de operação inválida para usar a leitura inteligente.");
    }
    const body = await request.json().catch(() => ({}));
    const db = requireDatabase(env);
    let runId = String(body?.runId || "").trim();
    let payload;
    if (runId) {
      const stored = await getRunPayload(db, runId);
      if (!stored?.payload) throw new HttpError(404, "Ronda não encontrada para a leitura inteligente.");
      payload = withEditorias({ ...stored.payload, runId: stored.id, triggerType: stored.triggerType, storedAt: stored.completedAt });
    } else {
      payload = withEditorias(await getLatestRound(db));
      runId = payload?.runId || "latest";
    }
    if (!payload?.ok || !Array.isArray(payload.topics)) throw new HttpError(409, "Não há uma ronda válida disponível para análise.");
    const topicId = intelligentCarouselRoute[1];
    const topic = payload.topics.find((item) => item?.id === topicId);
    if (!topic) throw new HttpError(404, "Assunto não encontrado nesta ronda.");
    const cacheKey = intelligentCarouselCacheKey(runId, topic);
    if (!body?.force) {
      const cached = await getIntelligentCarousel(db, cacheKey);
      if (cached) return json({ ok: true, cached: true, status: "succeeded", data: cached });
    }

    const queued = await createIntelligentJob(db, {
      cacheKey,
      runId,
      topicId,
      replaceCompleted: Boolean(body?.force),
    });
    if (queued.job.status === "succeeded" && queued.job.payload) {
      return json({ ok: true, cached: true, status: "succeeded", data: queued.job.payload });
    }
    if (queued.created) {
      if (env.INTELLIGENT_JOBS_QUEUE?.send) {
        try {
          await env.INTELLIGENT_JOBS_QUEUE.send({
            jobId: queued.job.jobId,
            runId: queued.job.runId,
            topicId: queued.job.topicId,
          });
          queued.job = await updateIntelligentJob(db, {
            jobId: queued.job.jobId,
            status: "queued",
            progress: 2,
            message: "Leitura enviada para processamento seguro.",
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          await updateIntelligentJob(db, {
            jobId: queued.job.jobId,
            status: "failed",
            progress: 100,
            message: "Não foi possível enviar a leitura para a fila.",
            error: detail,
          });
          throw new HttpError(503, "Fila de leitura indisponível.", detail);
        }
      } else {
        const data = await processIntelligentCarouselJob(env, queued.job, topic);
        if (data) return json({ ok: true, cached: false, status: "succeeded", data });
        throw new HttpError(503, "A leitura inteligente não foi concluída.", "Configure o binding INTELLIGENT_JOBS_QUEUE para processamento assíncrono estável.");
      }
    }
    return json({
      ok: true,
      queued: true,
      status: queued.job.status,
      job: publicIntelligentJob(queued.job),
      pollAfterMs: 1_200,
    }, 202);
  }

  if (url.pathname === "/api/round" && request.method === "POST") {
    if (env.MANUAL_ROUND_TOKEN && !secureEqual(request.headers.get("X-Round-Token"), env.MANUAL_ROUND_TOKEN)) {
      throw new HttpError(401, "Chave de operação inválida.");
    }
    const db = requireDatabase(env);
    const throttle = await acquireLock(db, "manual-throttle", 60 * 1000);
    if (!throttle) throw new HttpError(429, "Aguarde um minuto antes de executar outra ronda manual.");
    const lock = await acquireLock(db, "editorial-round", 3 * 60 * 1000);
    if (!lock) throw new HttpError(409, "Já existe uma ronda em andamento.");
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await startRun(db, { id: runId, triggerType: "manual", startedAt });
    } catch (error) {
      await releaseLock(db, lock);
      throw error;
    }
    const latestForOlderPanels = withEditorias(await getLatestRound(db).catch(() => null));
    const compatibilityData = latestForOlderPanels?.ok && Array.isArray(latestForOlderPanels.topics)
      ? latestForOlderPanels
      : {
          ok: true,
          collectedAt: startedAt,
          windowHours: 24,
          sources: [],
          totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
          items: [],
          topics: [],
        };
    const task = performRound(env, "manual", { lock, runId, startedAt, runStarted: true }).catch((error) => {
      console.error("Ronda manual falhou", error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
    return json({ ok: true, queued: true, runId, status: "running", data: compatibilityData }, 202);
  }

  throw new HttpError(404, "Rota não encontrada.");
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, ctx);
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método não permitido.");
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /api/\n", { headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  const asset = UI_ASSETS[url.pathname];
  if (asset) return request.method === "HEAD" ? new Response(null, { headers: { ...SECURITY_HEADERS, "Content-Type": asset.contentType } }) : assetResponse(asset);
  return json({ ok: false, error: "Página não encontrada." }, 404);
}



const __default__ = {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Erro interno do serviço.";
      const detail = error instanceof HttpError ? error.detail : error instanceof Error ? error.message.slice(0, 300) : null;
      return json({ ok: false, error: message, ...(detail ? { detail } : {}) }, status);
    }
  },

  async queue(batch, env) {
    await processIntelligentQueueBatch(batch, env);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      performRound(env, "scheduled").catch((error) => {
        console.error("Ronda agendada falhou", error);
      }),
    );
  },
};

return { "handleRequest": handleRequest, "performRound": performRound, "processIntelligentCarouselJob": processIntelligentCarouselJob, "processIntelligentQueueBatch": processIntelligentQueueBatch, "selfTest": selfTest, default: __default__ };
})();

export const handleRequest = __module_src_index_js["handleRequest"];
export const performRound = __module_src_index_js["performRound"];
export const processIntelligentCarouselJob = __module_src_index_js["processIntelligentCarouselJob"];
export const processIntelligentQueueBatch = __module_src_index_js["processIntelligentQueueBatch"];
export const selfTest = __module_src_index_js["selfTest"];
export default __module_src_index_js.default;
