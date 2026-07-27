import { buildCarouselBrief, buildTopics, classifyEditoria } from "./clustering.js";
import { ARTICLE_ANALYSIS_MODEL, buildIntelligentCarousel, extractArticleFromHtml, intelligentCarouselCacheKey, validateArticleUrl } from "./article-reader.js";
import { collectRound, customSourceFeed, FEEDS } from "./collector.js";
import {
  acquireLock,
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
  updateIntelligentJob,
} from "./database.js";
import { parseFeed, plainText } from "./parser.js";
import { portugueseOnlyFallback, TRANSLATION_MODEL, translateRoundPayload } from "./translation.js";
import { UI_ASSETS } from "./ui.generated.js";

const VERSION = "2.4.0";
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
      const [customSources, monitoringTerms] = await Promise.all([
        listCustomSources(db, { activeOnly: true }),
        listMonitoringTerms(db, { activeOnly: true }),
      ]);
      payload = await collectRound({
        feeds: [...FEEDS, ...customSources.map(customSourceFeed)],
        monitoringTerms,
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

export { handleRequest, performRound, processIntelligentCarouselJob, processIntelligentQueueBatch, selfTest };

export default {
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
