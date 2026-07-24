import { buildCarouselBrief, buildTopics, classifyEditoria } from "./clustering.js";
import { ARTICLE_ANALYSIS_MODEL, buildIntelligentCarousel, extractArticleFromHtml, intelligentCarouselCacheKey } from "./article-reader.js";
import { collectRound } from "./collector.js";
import {
  acquireLock,
  createIntelligentJob,
  databaseHealth,
  databaseSelfTest,
  ensureSchema,
  getIntelligentCarousel,
  getIntelligentJob,
  getLatestRound,
  getRunHistory,
  getRunPayload,
  getRunStatus,
  releaseLock,
  saveIntelligentCarousel,
  saveRun,
  startRun,
  updateIntelligentJob,
} from "./database.js";
import { parseFeed } from "./parser.js";
import { portugueseOnlyFallback, TRANSLATION_MODEL, translateRoundPayload } from "./translation.js";
import { UI_ASSETS } from "./ui.generated.js";

const VERSION = "2.1.1";
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
      const enriched = topic?.editoria
        ? topic
        : { ...topic, editoria: classifyEditoria(topic?.items || []) };
      const expectedUrls = new Set((enriched?.items || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselUrls = new Set((enriched?.carousel?.verificationLinks || [])
        .map((item) => String(item?.url || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)));
      const carouselHasEveryLink = expectedUrls.size > 0 && [...expectedUrls].every((url) => carouselUrls.has(url));
      return enriched?.carousel?.slides?.length && carouselHasEveryLink
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
            when: "Na data informada pelas matérias da ronda.",
            impact: "A medida pode orientar investimentos e mudanças na mobilidade urbana.",
            repercussion: "O tema também apareceu em publicações sociais monitoradas pela ronda.",
          },
          entities: {
            people: [],
            companies: ["Congresso Nacional"],
            places: ["Brasil"],
            dates: [],
            themes: ["mobilidade urbana", "política pública"],
            keywords: ["mobilidade", "Congresso", "investimentos"],
          },
          slides: [
            { number: 1, role: "Título principal", title: "Congresso aprova plano de mobilidade urbana", body: "A proposta avança e passa a orientar novas medidas no país." },
            { number: 2, role: "Contexto", title: "Por que o tema importa", body: "A mobilidade urbana afeta deslocamentos, transporte público e planejamento das cidades." },
            { number: 3, role: "Informação principal", title: "O que foi aprovado", body: "O Congresso aprovou um novo plano nacional para o setor." },
            { number: 4, role: "Detalhamento", title: "O que as matérias mostram", body: "Os textos relacionam a medida a investimentos e projetos de infraestrutura." },
            { number: 5, role: "Consequência", title: "Impacto esperado", body: "A decisão pode influenciar prioridades e recursos destinados às cidades." },
            { number: 6, role: "Conclusão", title: "Próximos passos", body: "A aplicação prática dependerá dos desdobramentos e das regras complementares." },
            { number: 7, role: "CTA", title: "Acompanhe a pauta", body: "Consulte as fontes originais e acompanhe as próximas atualizações." },
          ],
        },
      }),
    };
  }
  return null;
}


function publicIntelligentJob(job) {
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
  };
}

async function processIntelligentCarouselJob(env, job, topic) {
  const db = requireDatabase(env);
  const started = await updateIntelligentJob(db, {
    jobId: job.jobId,
    status: "running",
    progress: 4,
    message: "Preparando a leitura das fontes.",
  });
  if (!started) return null;
  try {
    const data = await buildIntelligentCarousel(topic, {
      ai: articleAnalysisAi(env),
      model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      fetcher: fetch,
      liveReading: env.ARTICLE_LIVE_READING !== "0",
      onProgress: async ({ progress, message }) => {
        await updateIntelligentJob(db, {
          jobId: job.jobId,
          status: "running",
          progress,
          message,
        });
      },
    });
    const storedData = {
      ...data,
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      topicTitle: topic.title,
    };
    await saveIntelligentCarousel(db, {
      cacheKey: job.cacheKey,
      runId: job.runId,
      topicId: job.topicId,
      payload: storedData,
      ttlHours: 48,
    });
    await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "succeeded",
      progress: 100,
      message: "Roteiro concluído.",
      payload: storedData,
    });
    return storedData;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await updateIntelligentJob(db, {
      jobId: job.jobId,
      status: "failed",
      progress: 100,
      message: "A leitura foi interrompida.",
      error: detail,
    });
    console.error("Leitura inteligente falhou", detail);
    return null;
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
      if (!job || (job.status === "succeeded" && job.payload)) {
        message?.ack?.();
        continue;
      }
      const topic = await resolveTopicForIntelligentJob(env, job);
      await processIntelligentCarouselJob(env, job, topic);
      message?.ack?.();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Consumidor da fila de leitura inteligente falhou", detail);
      try {
        await updateIntelligentJob(requireDatabase(env), {
          jobId,
          status: "failed",
          progress: 100,
          message: "A leitura foi interrompida no consumidor da fila.",
          error: detail,
        });
      } catch {}
      if (Number(message?.attempts || 1) < 3 && message?.retry) message.retry({ delaySeconds: 5 });
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
      payload = await collectRound();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("O coletor não retornou um resultado válido.");
      }
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
        totals: { items: 0, topics: 0, sources: 0, socialItems: 0 },
        items: [],
        topics: [],
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
      translation: {
        ready: Boolean(translationAi(env)?.run),
        targetLanguage: "pt-BR",
        model: TRANSLATION_MODEL,
      },
      intelligentReading: {
        ready: true,
        aiReady: Boolean(articleAnalysisAi(env)?.run),
        mode: "live-article-with-feed-fallback",
        asynchronousJobs: true,
        queueReady: Boolean(env.INTELLIGENT_JOBS_QUEUE?.send),
        executionMode: env.INTELLIGENT_JOBS_QUEUE?.send ? "cloudflare-queue" : "request-fallback",
        articleLimit: 5,
        model: env.ARTICLE_ANALYSIS_MODEL || ARTICLE_ANALYSIS_MODEL,
      },
    });
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

    const queued = await createIntelligentJob(db, { cacheKey, runId, topicId });
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

  async queue(batch, env, ctx) {
    ctx.waitUntil(processIntelligentQueueBatch(batch, env));
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      performRound(env, "scheduled").catch((error) => {
        console.error("Ronda agendada falhou", error);
      }),
    );
  },
};
