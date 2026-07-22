import { buildTopics } from "./clustering.js";
import { getCachedTranslations, saveCachedTranslations } from "./database.js";
import { plainText, stableHash } from "./parser.js";

export const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const SPANISH_SOURCES = new Set(["El País", "Infobae"]);
const PORTUGUESE_WORDS = /\b(que|para|com|uma|das|dos|não|mais|sobre|após|entre|governo|notícia|brasil|mundo|novo|nova|segundo|diz)\b/i;

function cleanTranslation(value, limit) {
  const text = plainText(value).replace(/^(["“”']+)|(["“”']+)$/g, "").trim();
  return text.slice(0, limit);
}

export function sourceLanguage(item) {
  return SPANISH_SOURCES.has(item?.collectorName || item?.sourceName) ? "es" : "en";
}

export function translationKey(text, language) {
  return `pt-v1-${stableHash(`${language}|${plainText(text)}`)}`;
}

export function isLikelyPortuguese(value) {
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

export async function translateText(ai, text, language) {
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

export async function translateWorldItems(items, { ai, cached = new Map(), concurrency = 8 } = {}) {
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
    translatedItems.push({
      ...item,
      title: cleanTranslation(title, 240),
      description: cleanTranslation(description, 420),
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

export async function translateRoundPayload(payload, { ai, db } = {}) {
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
    totals: { items: finalItems.length, topics: topics.length, sources: sourceCount, socialItems },
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

export function portugueseOnlyFallback(payload) {
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
    totals: { items: items.length, topics: topics.length, sources: sourceCount, socialItems },
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
