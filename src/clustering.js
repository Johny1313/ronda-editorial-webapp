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

  return {
    id: `topic-${stableHash(cluster.tokens.slice(0, 6).join("-"))}`,
    title: representative?.title ?? "Assunto sem título",
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
}

export function buildTopics(items, now = new Date(), limit = 40) {
  return clusterItems(items)
    .map((cluster) => clusterToTopic(cluster, now))
    .sort((left, right) => right.score - left.score || Date.parse(right.lastPublishedAt) - Date.parse(left.lastPublishedAt))
    .slice(0, limit);
}
