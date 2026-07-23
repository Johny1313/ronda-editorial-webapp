import { plainText, stableHash } from "./parser.js";

const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "entre", "foi", "ha",
  "mais", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "se", "sem", "ser", "sob", "sobre",
  "um", "uma", "vai", "apos", "ante", "ate", "contra", "durante", "noticia", "noticias", "hoje", "veja", "diz",
  "afirma", "novo", "nova", "brasil", "brasileiro", "brasileira",
]);

export function normalizeText(value = "") {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titleTokens(title) {
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

export function tokenSimilarity(left, right) {
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
  ["Esportes", ["futebol", "jogo", "partida", "campeonato", "brasileirao", "copa", "clube", "time", "jogador", "jogadora", "gol", "tecnico", "selecao", "formula 1", "f1", "basquete", "volei", "tenis", "olimpiada", "esporte"]],
  ["Política", ["presidente", "congresso", "senado", "camara", "deputado", "senador", "ministro", "governo", "eleicao", "eleitoral", "stf", "supremo", "partido", "prefeito", "governador", "planalto", "projeto de lei", "votacao", "politica"]],
  ["Entretenimento", ["filme", "serie", "novela", "musica", "cantor", "cantora", "atriz", "ator", "show", "festival", "televisao", "cinema", "streaming", "celebridade", "bbb", "reality", "oscar", "entretenimento"]],
  ["Economia", ["economia", "inflacao", "dolar", "bolsa", "juros", "banco", "mercado", "empresa", "emprego", "desemprego", "pib", "imposto", "investimento", "financeiro", "combustivel", "petroleo"]],
  ["Mundo", ["estados unidos", "eua", "trump", "guerra", "ucrania", "russia", "israel", "gaza", "china", "europa", "onu", "internacional", "exterior"]],
  ["Tecnologia", ["tecnologia", "inteligencia artificial", "ia", "internet", "aplicativo", "software", "celular", "smartphone", "google", "microsoft", "apple", "meta", "rede social", "digital"]],
  ["Saúde", ["saude", "doenca", "vacina", "hospital", "medico", "medicina", "virus", "covid", "medicamento", "tratamento", "epidemia", "paciente"]],
]);

function keywordMatch(text, keyword) {
  if (keyword.includes(" ")) return text.includes(keyword);
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

export function classifyEditoria(items = []) {
  const text = normalizeText(items.map((item) => `${item?.title || ""} ${item?.description || ""}`).join(" "));
  let selected = "Notícias";
  let selectedScore = 0;
  for (const [editoria, keywords] of EDITORIA_RULES) {
    const score = keywords.reduce((total, keyword) => total + (keywordMatch(text, keyword) ? 1 : 0), 0);
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
  if (["Saúde", "Tecnologia"].includes(editoria)) return "Explicativo e cauteloso";
  if (["Esportes", "Entretenimento"].includes(editoria)) return "Dinâmico e acessível";
  return "Informativo e objetivo";
}

function carouselModel(topic, normalizedText) {
  if (topic.priority === "Pautar agora") return "Plantão em 5 cards";
  if (/\b(alerta|prazo|calendario|inscricao|como|servico|transito|previsao)\b/.test(normalizedText)) return "Post de serviço";
  if ((topic.sourceNames?.length || topic.sourceCount || 0) >= 3 || (topic.items?.length || topic.itemCount || 0) >= 3) return "Explicativo em 5 cards";
  if (["Esportes", "Entretenimento"].includes(topic.editoria)) return "Destaques em 5 cards";
  return "Resumo factual em 5 cards";
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

export function buildCarouselBrief(topic = {}) {
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
    disclaimer: "Roteiro automático baseado nos títulos e descrições dos feeds. Abra os links de apuração, revise e confirme antes de publicar.",
    verificationLinks,
    slides: [
      { number: 1, role: "Capa", title, body: `${editoria} · ${displayedSourceCount} ${displayedSourceCount === 1 ? "fonte monitorada" : "fontes monitoradas"}` },
      { number: 2, role: "Contexto", title: "O que aconteceu", body: context },
      { number: 3, role: "Pontos principais", title: "O que já sabemos", body: knownFacts },
      { number: 4, role: "Relevância", title: "Por que acompanhar", body: significance },
      { number: 5, role: "Fontes e CTA", title: "Continue acompanhando", body: `${sourceLine}\n${verificationLinks.length} ${verificationLinks.length === 1 ? "link de apuração disponível" : "links de apuração disponíveis"}.\n${callToAction}` },
    ],
  };
}

export function clusterItems(items, threshold = 0.36) {
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

export function clusterToTopic(cluster, now = new Date()) {
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

export function buildTopics(items, now = new Date(), limit = 40) {
  return clusterItems(items)
    .map((cluster) => clusterToTopic(cluster, now))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt))
    .slice(0, limit);
}
