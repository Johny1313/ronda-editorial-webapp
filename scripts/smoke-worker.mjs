import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const publishedAt = new Date().toUTCString();
const createdAt = new Date().toISOString();

async function mockExternalSource(request) {
  const url = new URL(request.url);
  if (url.hostname === "news.google.com") {
    const query = decodeURIComponent(url.searchParams.get("q") || "");
    if (query.includes('"Vini Jr"')) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
          <item><title>Vini Jr marca e decide partida internacional</title><link>https://noticias.test/vini-jr/partida</link><pubDate>${publishedAt}</pubDate><description>Atacante brasileiro foi destaque no jogo.</description><source>Portal Esportivo</source></item>
        </channel></rss>`,
        { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
      );
    }
    if (query.includes("site:portal-local.test")) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
          <item><title>Portal local acompanha investimentos em mobilidade</title><link>https://noticias.test/portal-local/mobilidade</link><pubDate>${publishedAt}</pubDate><description>Site cadastrado publicou uma atualização local.</description></item>
        </channel></rss>`,
        { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
      );
    }
    if (["portalleodias.com", "uol.com.br/splash", "fatosdesconhecidos.com.br", "canaltech.com.br/curiosidades"].some((site) => query.includes(site))) {
      const portals = [
        ["UOL", "uol-splash", "Famosa comenta os bastidores de novo reality"],
        ["LeoDias", "leo-dias", "Influenciadora confirma novo relacionamento"],
        ["Quem", "quem", "Atriz fala sobre casamento e carreira"],
        ["CARAS Brasil", "caras-brasil", "Celebridade revela novidade da vida pessoal"],
        ["Contigo!", "contigo", "Artista comenta polêmica nas redes"],
        ["TV Foco", "tv-foco", "Programa de televisão anuncia nova temporada"],
        ["Purepeople", "purepeople", "Famosos prestigiam evento em São Paulo"],
        ["Observatório dos Famosos", "observatorio", "Cantora responde rumores sobre namoro"],
        ["Área VIP", "area-vip", "Participante é eliminado de reality show"],
        ["NaTelinha", "natelinha", "Reality prepara nova prova do líder"],
        ["Fatos Desconhecidos", "fatos", "Vídeo curioso viraliza nas redes sociais"],
        ["Mega Curioso", "mega-curioso", "Descoberta arqueológica surpreende cientistas"],
        ["Hypeness", "hypeness", "Projeto criativo ganha repercussão na internet"],
        ["Incrível.club", "incrivel", "Lista de curiosidades é compartilhada por internautas"],
        ["Mistérios do Mundo", "misterios", "Fenômeno raro intriga pesquisadores"],
        ["Canaltech", "canaltech-curiosidades", "Curiosidade científica explica fenômeno digital"],
        ["Superinteressante", "super", "Estudo revela novo dado sobre o universo"],
        ["Galileu", "galileu", "Pesquisa detalha descoberta de nova espécie"],
        ["Segredos do Mundo", "segredos", "Mistério histórico ganha nova explicação"],
        ["Awebic", "awebic", "História inspiradora repercute nas redes sociais"],
      ];
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${portals.map(([source, slug, title]) => `<item><title>${title}</title><link>https://noticias.test/${slug}/materia</link><pubDate>${publishedAt}</pubDate><description>Conteúdo de teste do portal ${source}.</description><source>${source}</source></item>`).join("")}</channel></rss>`,
        { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
      );
    }
  }
  if (url.hostname === "noticias.test") {
    const articleText = "O Congresso aprovou um novo plano nacional de mobilidade urbana para orientar investimentos em transporte público, ciclovias, acessibilidade e segurança viária. A proposta estabelece diretrizes para a integração entre governos, definição de prioridades e acompanhamento dos projetos. A implantação deverá ocorrer em etapas e ainda depende de detalhamento técnico, prazos, fontes de financiamento e regras complementares. Especialistas ouvidos pelos portais afirmam que a medida pode influenciar a distribuição de recursos e a escolha das obras realizadas nas cidades. O tema ganhou repercussão entre profissionais do setor e representantes de administrações locais, que pedem clareza sobre os próximos passos.";
    return new Response(`<!doctype html><html><head><meta property="og:title" content="Plano nacional de mobilidade urbana"><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "Plano nacional de mobilidade urbana", datePublished: createdAt, author: { name: "Redação" }, articleBody: `${articleText} ${articleText}` })}</script></head><body><nav>Menu</nav><div class="publicidade">Anúncio</div><article><p>${articleText}</p></article></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (url.hostname === "public.api.bsky.app") {
    return Response.json({
      posts: [
        {
          uri: "at://did:plc:smoketest/app.bsky.feed.post/roundtest",
          indexedAt: createdAt,
          record: { text: "Novo plano nacional de mobilidade urbana aprovado pelo Congresso", createdAt },
          author: { handle: "redacao.test", displayName: "Redação de teste" },
          replyCount: 12,
          likeCount: 40,
          repostCount: 8,
          quoteCount: 2,
        },
      ],
    });
  }

  const source = encodeURIComponent(`${url.hostname}${url.pathname}`);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
      <item><title>Congresso aprova novo plano nacional de mobilidade urbana</title><link>https://noticias.test/${source}/mobilidade</link><pubDate>${publishedAt}</pubDate><description>Medida foi aprovada nesta manhã.</description></item>
      <item><title>Setor de energia divulga novo relatório de investimentos</title><link>https://noticias.test/${source}/energia</link><pubDate>${publishedAt}</pubDate><description>Relatório aponta novos projetos.</description></item>
    </channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
}

const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("../dist/cloudflare-worker-unico.js", import.meta.url)),
  compatibilityDate: "2026-07-22",
  bindings: { ENVIRONMENT: "test", TRANSLATION_TEST_MODE: "1", ARTICLE_ANALYSIS_TEST_MODE: "1" },
  d1Databases: { DB: `ronda-smoke-${crypto.randomUUID()}` },
  queueProducers: { INTELLIGENT_JOBS_QUEUE: "ronda-editorial-intelligent-jobs" },
  queueConsumers: {
    "ronda-editorial-intelligent-jobs": {
      maxBatchSize: 1,
      maxBatchTimeout: 1,
      maxRetries: 3,
      retryDelay: 1,
    },
  },
  outboundService: mockExternalSource,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path, options) {
  const response = await mf.dispatchFetch(`http://ronda.test${path}`, options);
  const body = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(body)}`);
  return { response, body };
}

try {
  const home = await mf.dispatchFetch("http://ronda.test/");
  const html = await home.text();
  assert(home.status === 200 && html.includes("Ronda Editorial"), "Dashboard não abriu corretamente.");
  assert(html.includes("/app.js?v=2.4.2") && html.includes("/styles.css?v=2.4.2"), "Versão dos arquivos da interface não está fixada.");
  assert(html.includes('id="editoriaFilter"'), "Filtro de editorias não foi incorporado ao Worker.");
  assert(html.includes('data-editoria="Fofoca e Celebridades"') && html.includes('data-editoria="Reality Shows"') && html.includes('data-editoria="Curiosidades e Ciência Pop"') && html.includes('data-editoria="Luto e Obituário"'), "Novas editorias especializadas não foram incorporadas ao Worker.");
  assert(html.includes('id="carouselModal"') && html.includes('id="copyCarousel"'), "Roteiro de carrossel não foi incorporado ao Worker.");
  assert(html.includes('id="carouselSources"'), "Lista de links para apuração não foi incorporada ao carrossel.");
  assert(html.includes('id="carouselReading"') && html.includes('id="carouselEvidence"') && html.includes('id="carouselAnalysis"') && html.includes('id="carouselEntities"'), "Leitura inteligente e evidências não foram incorporadas ao modal.");
  assert(!html.includes('id="carouselImages"'), "A área de sugestões de imagens ainda está presente no carrossel.");
  assert(html.includes('id="sourcesView"') && html.includes('id="sourcePortalGrid"'), "Tela de Fontes não foi incorporada ao Worker.");
  assert(html.includes('id="customSourcesView"') && html.includes('id="customSourceForm"') && html.includes('id="navCustomSources"'), "Cadastro de sites não foi incorporado ao Worker.");
  assert(html.includes('id="monitoringView"') && html.includes('id="monitoringTermForm"') && html.includes('id="dedicatedNewsList"') && html.includes('id="navMonitoring"'), "Monitoramento dedicado não foi incorporado ao Worker.");
  assert(html.includes('id="regionFilter"'), "Filtro Brasil/Mundo não foi incorporado ao Worker.");
  assert(html.includes('id="historyDetail"') && html.includes('id="historyBack"'), "Detalhes clicáveis do histórico não foram incorporados ao Worker.");
  assert(home.headers.get("content-security-policy"), "CSP ausente no dashboard.");
  assert(home.headers.get("cache-control")?.includes("no-store"), "Dashboard ainda permite cache incompatível entre versões.");

  const selfTest = await getJson("/api/self-test");
  assert(selfTest.body.ok && selfTest.body.database?.readWriteDelete, "Autoteste lógico/D1 falhou.");

  const customSourceCreated = await getJson("/api/custom-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Portal Local", url: "https://portal-local.test/", region: "Brasil" }),
  });
  assert(customSourceCreated.response.status === 201 && customSourceCreated.body.source?.active, "Site personalizado não foi cadastrado.");
  await getJson(`/api/custom-sources/${customSourceCreated.body.source.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false }),
  });
  const customSourceReactivated = await getJson(`/api/custom-sources/${customSourceCreated.body.source.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  assert(customSourceReactivated.body.source?.active, "Site personalizado não foi reativado.");
  const configuredSources = await getJson("/api/custom-sources");
  assert(configuredSources.body.sources?.length === 1 && configuredSources.body.limits?.maximumActive === 8, "Lista de sites personalizados inconsistente.");

  const monitoringTermCreated = await getJson("/api/monitoring-terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term: "Vini Jr" }),
  });
  assert(monitoringTermCreated.response.status === 201 && monitoringTermCreated.body.term?.active, "Termo dedicado não foi cadastrado.");
  const configuredTerms = await getJson("/api/monitoring-terms");
  assert(configuredTerms.body.terms?.length === 1 && configuredTerms.body.limits?.maximumActive === 6, "Lista de termos dedicados inconsistente.");

  const round = await getJson("/api/round", { method: "POST" });
  assert(round.response.status === 202 && round.body.runId, "Ronda simulada não foi iniciada em segundo plano.");
  assert(round.body.data?.collectedAt, "Resposta compatível para painéis antigos não foi incluída.");
  let runStatus;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await getJson(`/api/runs/${round.body.runId}`);
    runStatus = status.body.run;
    if (runStatus?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(runStatus?.status === "success", "Ronda simulada não concluiu.");

  const latest = await getJson("/api/latest");
  const roundData = latest.body.data;
  assert(roundData?.runId === round.body.runId, "Última ronda não foi recuperada do D1.");
  assert(roundData.totals.items >= 10, "Ronda simulada trouxe poucos conteúdos.");
  assert(roundData.totals.socialItems >= 1, "Complemento do Bluesky não foi incorporado.");
  assert(roundData.sources.every((source) => source.ok), "Uma fonte simulada falhou.");
  assert(roundData.sources.length === 52, "O catálogo não contém os 50 portais, o site cadastrado e o complemento Bluesky.");
  assert(roundData.sources.filter((source) => source.region === "Brasil").length === 38, "Catálogo Brasil e sites cadastrados incompletos.");
  assert(roundData.sources.filter((source) => source.region === "Mundo").length === 13, "Catálogo Mundo incompleto.");
  assert(roundData.sources.some((source) => source.name === "Portal Local" && source.ok), "O site cadastrado não foi incorporado à ronda.");
  assert(roundData.translation?.targetLanguage === "pt-BR" && roundData.translation?.portugueseOnly, "A ronda não garantiu saída em português.");
  assert(roundData.translation?.translatedWorldItems > 0 && roundData.translation?.generatedFields > 0, "A tradução internacional não foi executada.");
  assert(roundData.items.filter((item) => item.region === "Mundo").every((item) => item.targetLanguage === "pt-BR"), "Há conteúdo internacional sem tradução.");
  assert(roundData.items.every((item) => /^https?:\/\//i.test(item.url)), "Há notícia captada sem link válido para apuração.");
  assert(roundData.dedicatedMonitoring?.items?.length === 1 && roundData.dedicatedMonitoring.items[0].monitoringTerm === "Vini Jr", "A busca dedicada não retornou o termo cadastrado.");
  assert(roundData.dedicatedMonitoring.items[0].title.includes("Vini Jr"), "A notícia dedicada esperada não foi armazenada.");
  assert(roundData.items.every((item) => item.kind !== "monitoring" && !item.monitoringTermId), "Notícia dedicada vazou para a aba Ronda.");
  assert(roundData.topics.every((topic) => (topic.items || []).every((item) => item.kind !== "monitoring")), "Notícia dedicada vazou para os assuntos da Ronda.");
  assert(roundData.topics.every((topic) => topic.editoria), "Os assuntos não receberam editorias.");
  assert(roundData.topics.every((topic) => topic.carousel?.slides?.length === 7), "As prévias de carrossel em sete slides não foram geradas.");
  assert(roundData.topics.every((topic) => topic.carousel?.voiceTone && topic.carousel?.postModel), "Tom de voz ou modelo de post ausente.");
  assert(roundData.topics.every((topic) => topic.carousel?.language === "pt-BR"), "Um carrossel não está marcado como português.");
  assert(roundData.topics.every((topic) => !("imageSuggestions" in topic.carousel)), "A API ainda gera sugestões de imagens para o carrossel.");
  assert(roundData.topics.every((topic) => {
    const itemUrls = new Set((topic.items || []).map((item) => item.url).filter((url) => /^https?:\/\//i.test(url)));
    const linkUrls = new Set((topic.carousel?.verificationLinks || []).map((item) => item.url));
    return itemUrls.size > 0 && [...itemUrls].every((url) => linkUrls.has(url));
  }), "Um carrossel não contém todos os links individuais para apuração.");

  const topicForReading = roundData.topics.find((topic) => (topic.items || []).some((item) => item.kind === "portal"));
  assert(topicForReading, "Nenhum assunto com matéria de portal foi encontrado para a leitura inteligente.");
  const intelligentQueued = await getJson(`/api/topics/${topicForReading.id}/intelligent-carousel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: round.body.runId }),
  });
  assert(intelligentQueued.response.status === 202 && intelligentQueued.body.job?.jobId, "A leitura inteligente não foi iniciada como tarefa assíncrona.");
  let intelligentData = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await getJson(`/api/intelligent-jobs/${intelligentQueued.body.job.jobId}`);
    if (status.body.job?.status === "failed") throw new Error(`Leitura inteligente falhou: ${status.body.job.error}`);
    if (status.body.job?.status === "succeeded") {
      intelligentData = status.body.data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(intelligentData?.slides?.length === 7, "A leitura inteligente não gerou sete slides.");
  assert(intelligentData?.analysisMode === "ai", "A leitura inteligente não usou o Workers AI simulado.");
  assert(intelligentData?.reading?.successful >= 1 && intelligentData?.reading?.liveSuccessful >= 1 && intelligentData?.reading?.totalWords > 20 && intelligentData?.reading?.basis === "single-live-article-with-feed-fallback", "A leitura direta da matéria selecionada não foi utilizada.");
  assert(intelligentData?.questions?.whatHappened && intelligentData?.entities?.themes?.length, "Interpretação ou dados estruturados ausentes.");
  assert(intelligentData?.facts?.length && intelligentData?.validation?.passed, "Mapa de fatos ou validação editorial ausente.");
  assert(intelligentData?.cycle?.terminal && intelligentData?.cycle?.released && intelligentData?.cycle?.nextCycleAllowed, "O ciclo concluído não liberou o sistema.");
  const intelligentCached = await getJson(`/api/topics/${topicForReading.id}/intelligent-carousel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: round.body.runId }),
  });
  assert(intelligentCached.body.cached === true, "O carrossel inteligente não foi reutilizado do cache D1.");
  const forcedCycle = await getJson(`/api/topics/${topicForReading.id}/intelligent-carousel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: roundData.runId, force: true }),
  });
  assert(forcedCycle.response.status === 202 && forcedCycle.body.job?.jobId && forcedCycle.body.job.jobId !== intelligentQueued.body.job.jobId, "Um novo ciclo forçado não criou uma tarefa independente.");
  let forcedReleased = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await getJson(`/api/intelligent-jobs/${forcedCycle.body.job.jobId}`);
    if (status.body.job?.status === "succeeded") {
      forcedReleased = Boolean(status.body.job.released && status.body.job.nextCycleAllowed && status.body.data?.cycle?.released);
      break;
    }
    if (status.body.job?.status === "failed") throw new Error(status.body.job.error || "O novo ciclo forçado falhou.");
    await delay(100);
  }
  assert(forcedReleased, "O novo ciclo não foi encerrado e liberado.");

  const historicalData = await getJson(`/api/runs/${round.body.runId}/data`);
  assert(historicalData.body.data?.items?.length === roundData.items.length, "Notícias da ronda histórica não foram recuperadas.");
  assert(historicalData.body.data.items[0]?.title, "Detalhe histórico não contém os títulos apurados.");

  const history = await getJson("/api/history?limit=10");
  assert(history.body.runs.some((run) => run.id === round.body.runId && run.status === "success"), "Histórico D1 não registrou a ronda.");

  const health = await getJson("/api/health");
  assert(health.body.ready && health.body.schedulerHealthy && health.body.version === "2.4.2", "Saúde do serviço não reconheceu a ronda ou a versão publicada.");
  assert(health.body.translation?.ready && health.body.translation?.targetLanguage === "pt-BR", "Saúde não confirmou o tradutor internacional.");
  assert(health.body.intelligentReading?.ready && health.body.intelligentReading?.mode === "single-article-with-feed-fallback" && health.body.intelligentReading?.articleLimit === 1 && health.body.intelligentReading?.readingStrategy === "single-best-source-with-history" && health.body.intelligentReading?.cycleFinalization === "terminal-and-released" && health.body.intelligentReading?.nextCycleAfterTerminal === true, "Saúde não confirmou a leitura inteligente e a liberação terminal.");
  assert(health.body.backgroundMonitoring?.active && health.body.backgroundMonitoring?.browserRequired === false && health.body.backgroundMonitoring?.execution === "cloudflare-cron" && health.body.backgroundMonitoring?.customSources === 1 && health.body.backgroundMonitoring?.monitoringTerms === 1, "Saúde não confirmou a coleta em segundo plano com sites e termos.");

  const deletedTerm = await getJson(`/api/monitoring-terms/${monitoringTermCreated.body.term.id}`, { method: "DELETE" });
  const deletedSource = await getJson(`/api/custom-sources/${customSourceCreated.body.source.id}`, { method: "DELETE" });
  assert(deletedTerm.body.deleted?.term === "Vini Jr" && deletedSource.body.deleted?.name === "Portal Local", "Cadastros de teste não foram removidos.");

  process.stdout.write(
    "Smoke test aprovado: dashboard, D1, sites cadastrados, termos isolados, execução em segundo plano, leitura inteligente, carrosséis de 7 slides e ciclo liberado.\n",
  );
} finally {
  await mf.dispose();
}
