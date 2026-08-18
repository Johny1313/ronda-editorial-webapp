import assert from "node:assert/strict";
import test from "node:test";
import { buildIntelligentCarousel, extractArticleFromHtml, validateArticleUrl } from "../src/article-reader.js";

const longParagraph = "A prefeitura apresentou um plano nacional de mobilidade urbana para reorganizar o transporte público, ampliar a integração entre bairros e definir novas prioridades de investimento. O texto aprovado estabelece diretrizes para corredores de ônibus, ciclovias, acessibilidade, segurança viária e planejamento de longo prazo. A implantação deverá ocorrer em etapas, com participação dos governos locais, análise técnica e acompanhamento dos órgãos de controle. A medida pode alterar a distribuição de recursos e influenciar projetos já anunciados pelas administrações municipais. Representantes do setor afirmaram que ainda será necessário detalhar prazos, fontes de financiamento e critérios para selecionar as obras prioritárias.";

function articleHtml(title) {
  return `<!doctype html><html><head><meta property="og:title" content="${title}"><script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    headline: title,
    datePublished: "2026-07-24T10:00:00Z",
    author: { name: "Redação Teste" },
    articleBody: `${longParagraph} ${longParagraph}`,
  })}</script></head><body><nav>Menu do portal</nav><div class="publicidade">Anúncio irrelevante</div><article><p>${longParagraph}</p></article></body></html>`;
}

test("extrai o conteúdo principal e remove ruído", () => {
  const result = extractArticleFromHtml(articleHtml("Plano de mobilidade é aprovado"));
  assert.equal(result.method, "json-ld");
  assert.ok(result.wordCount > 120);
  assert.match(result.content, /corredores de ônibus/);
  assert.doesNotMatch(result.content, /Anúncio irrelevante|Menu do portal/);
});

test("bloqueia URLs locais e privadas", () => {
  assert.throws(() => validateArticleUrl("http://127.0.0.1/admin"), /não permitida/);
  assert.throws(() => validateArticleUrl("http://192.168.1.10/painel"), /não permitida/);
  assert.equal(validateArticleUrl("https://portal.test/materia"), "https://portal.test/materia");
});

test("seleciona uma única matéria, gera o roteiro e encerra o ciclo", async () => {
  const topic = {
    id: "topic-mobilidade",
    title: "Congresso aprova plano de mobilidade urbana",
    editoria: "Política",
    items: [
      { id: "a", kind: "portal", title: "Congresso aprova plano", description: "O Congresso aprovou um plano nacional de mobilidade urbana, com novas diretrizes de transporte e investimentos.", content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content", sourceName: "Portal A", collectorName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/materia" },
      { id: "b", kind: "portal", title: "Plano prevê investimentos", description: "O texto prevê corredores de ônibus, ciclovias e integração tarifária, mas ainda depende de detalhamento.", sourceName: "Portal B", collectorName: "Portal B", publishedAt: "2026-07-24T09:50:00Z", url: "https://portal-b.test/materia" },
      { id: "c", kind: "social", title: "Plano repercute entre especialistas", sourceName: "Jornalista", publishedAt: "2026-07-24T10:05:00Z", url: "https://bsky.app/profile/test/post/abc", interactions: 30 },
    ],
  };
  let externalFetches = 0;
  const fetcher = async (url) => {
    externalFetches += 1;
    if (String(url).includes("portal-a.test")) {
      return new Response(articleHtml("Congresso aprova plano"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw new Error("portal bloqueou a leitura direta");
  };
  const aiInputs = [];
  const ai = {
    run: async (_model, input) => {
      aiInputs.push(input);
      return ({ response: {
      questions: {
        whatHappened: "O Congresso aprovou um plano nacional de mobilidade urbana.",
        who: "Congresso Nacional, governos locais e órgãos de controle.",
        where: "Brasil.",
        when: "Em 24 de julho de 2026.",
        impact: "A medida pode redefinir investimentos e prioridades de transporte.",
        repercussion: "Especialistas pedem detalhamento de prazos e financiamento.",
      },
      entities: {
        people: [], companies: ["Congresso Nacional"], places: ["Brasil"], dates: ["24 de julho de 2026"], themes: ["mobilidade urbana"], keywords: ["transporte", "investimentos"],
      },
      slides: Array.from({ length: 7 }, (_, index) => ({ number: index + 1, role: `Papel ${index + 1}`, title: `Título ${index + 1}`, subtitle: `Subtítulo factual do slide ${index + 1}.` })),
    } });
    },
  };

  const result = await buildIntelligentCarousel(topic, { ai, fetcher });
  assert.equal(externalFetches, 1);
  assert.equal(result.analysisMode, "ai-redaction-from-source-evidence");
  assert.equal(result.reading.basis, "single-publisher-article");
  assert.equal(result.reading.successful, 1);
  assert.equal(result.reading.liveSuccessful, 1);
  assert.equal(result.reading.fallbackSources, 0);
  assert.equal(result.reading.blockedSources, 0);
  assert.ok(result.reading.totalWords > 100);
  assert.equal(result.slides.length, 7);
  assert.ok(result.slides.every((slide) => slide.title && slide.subtitle && slide.body === slide.subtitle));
  assert.deepEqual(result.slides.map((slide) => slide.role), ["Título principal", "Contexto", "Informação principal", "Detalhamento", "Consequência", "Conclusão", "CTA"]);
  assert.equal(result.reading.publisherVerified, true);
  assert.equal(result.reading.factsGeneratedByAi, false);
  assert.equal(result.reading.strategy, "publisher-required-with-alternatives");
  assert.equal(result.reading.cycleMode, "one-read-article-one-script");
  assert.equal(result.reading.cycleComplete, true);
  assert.equal(result.reading.nextCycleAllowed, true);
  assert.equal(result.cycle.status, "completed");
  assert.equal(result.cycle.released, true);
  assert.equal(result.cycle.nextCycleAllowed, true);
  assert.equal(result.reading.selectedSource.sourceName, "Portal A");
  assert.ok(result.reading.selectedSource.selection.score > 0);
  assert.equal(result.reading.alternativesAvailable, 1);
  assert.ok(aiInputs.length >= 1 && aiInputs.length <= 2);
  assert.match(aiInputs[0].messages[0].content, /NÃO deve gerar fatos|não deve gerar fatos/i);
  assert.match(aiInputs[0].messages[1].content, /PORTAL LIDO: Portal A/);
  assert.match(aiInputs[0].messages[1].content, /EVIDÊNCIAS EXTRAÍDAS DO CONTEÚDO E DOS METADADOS DA MATÉRIA/);
  assert.doesNotMatch(aiInputs[0].messages[1].content, /Portal B detalha|Plano prevê investimentos/);
  assert.ok(result.facts.length >= 1);
  assert.ok(result.facts.every((fact) => fact.id && fact.claim && fact.evidence));
  assert.equal(result.validation.passed, true);
  assert.ok(result.validation.issues.some((issue) => issue.code === "unsupported-by-source" || issue.code === "unsupported-number"));
  assert.ok(result.slides.every((slide) => !/Subtítulo factual do slide/i.test(slide.subtitle)));
  assert.equal(result.editorialGate.copyAllowed, true);
  assert.ok(result.slides.every((slide) => slide.title.length <= 68 && slide.subtitle.length <= 190));
  assert.equal(result.verificationLinks.length, 3);
  assert.ok(result.reading.sources.every((source) => !("content" in source)));
});

test("não usa texto do feed como substituto da leitura do site", async () => {
  const topic = {
    id: "topic-fast-feed",
    title: "Plano de mobilidade urbana avança",
    editoria: "Política",
    items: [{
      id: "a", kind: "portal", title: "Plano de mobilidade urbana avança",
      content: `${longParagraph} ${longParagraph} ${longParagraph}`, contentSource: "feed-content",
      sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/fast",
    }],
  };
  let fetches = 0;
  await assert.rejects(
    buildIntelligentCarousel(topic, {
      fetcher: async () => { fetches += 1; throw new Error("portal bloqueado"); },
    }),
    /abrir e ler uma matéria publicada|evitar criar fatos/i,
  );
  assert.equal(fetches, 1);
});

test("bloqueia o carrossel quando a ronda possui apenas títulos", async () => {
  const topic = {
    id: "topic-limitado",
    title: "Assunto em desenvolvimento",
    editoria: "Notícias",
    items: [
      { id: "a", kind: "portal", title: "Primeira atualização do assunto", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/a" },
      { id: "b", kind: "portal", title: "Nova informação é divulgada", sourceName: "Portal B", publishedAt: "2026-07-24T09:50:00Z", url: "https://portal-b.test/b" },
    ],
  };
  await assert.rejects(
    buildIntelligentCarousel(topic, { fetcher: async () => { throw new Error("bloqueado"); } }),
    /abrir e ler uma matéria publicada|informação insuficiente/i,
  );
});

test("lê somente uma fonte mesmo quando o assunto possui vários portais", async () => {
  const topic = {
    id: "topic-multifonte",
    title: "Assunto acompanhado por vários portais",
    editoria: "Notícias",
    items: [
      { id: "a", kind: "portal", title: "Portal A publica a informação principal", description: "Informação principal confirmada pelo primeiro portal.", content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/a" },
      { id: "b", kind: "portal", title: "Portal B detalha o assunto", description: "O segundo portal apresenta contexto e detalhes adicionais.", sourceName: "Portal B", publishedAt: "2026-07-24T09:59:00Z", url: "https://portal-b.test/b" },
      { id: "c", kind: "portal", title: "Portal C repercute a notícia", description: "O terceiro portal registra a repercussão do acontecimento.", sourceName: "Portal C", publishedAt: "2026-07-24T09:58:00Z", url: "https://portal-c.test/c" },
      { id: "d", kind: "portal", title: "Portal D acompanha os desdobramentos", description: "O quarto portal acompanha os próximos passos.", sourceName: "Portal D", publishedAt: "2026-07-24T09:57:00Z", url: "https://portal-d.test/d" },
    ],
  };
  const fetchedUrls = [];
  const fetcher = async (url) => {
    fetchedUrls.push(String(url));
    return new Response(articleHtml("Portal A publica a informação principal"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  const progress = [];
  const result = await buildIntelligentCarousel(topic, {
    fetcher,
    articleTimeoutMs: 80,
    onProgress: async (event) => progress.push(event),
  });

  assert.deepEqual(fetchedUrls, ["https://portal-a.test/a"]);
  assert.equal(result.reading.requested, 1);
  assert.equal(result.reading.successful, 1);
  assert.equal(result.reading.liveSuccessful, 1);
  assert.equal(result.reading.fallbackSources, 0);
  assert.equal(result.reading.selectedSource.sourceName, "Portal A");
  assert.equal(result.reading.alternativesAvailable, 3);
  assert.equal(result.reading.cycleComplete, true);
  assert.ok(progress.some((event) => event.progress === 8));
  assert.ok(progress.some((event) => event.progress === 18));
  assert.ok(progress.some((event) => event.progress === 60));
  assert.match(progress.findLast((event) => event.stage === "reading")?.message || "", /Matéria apurada: Portal A/);
  assert.equal(result.slides.length, 7);
});

test("usa o histórico de leitura para escolher a fonte mais confiável", async () => {
  const topic = {
    id: "topic-historico",
    title: "Plano de mobilidade urbana avança",
    editoria: "Política",
    items: [
      { id: "a", kind: "portal", title: "Plano de mobilidade urbana avança", content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/a" },
      { id: "b", kind: "portal", title: "Plano de mobilidade urbana avança", content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content", sourceName: "Portal B", publishedAt: "2026-07-24T09:59:00Z", url: "https://portal-b.test/b" },
    ],
  };
  const fetched = [];
  const result = await buildIntelligentCarousel(topic, {
    sourceStats: {
      "portal-a.test": { attempts: 10, successes: 0 },
      "portal-b.test": { attempts: 10, successes: 10 },
    },
    fetcher: async (url) => {
      fetched.push(String(url));
      return new Response(articleHtml("Plano de mobilidade urbana avança"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
  assert.deepEqual(fetched, ["https://portal-b.test/b"]);
  assert.equal(result.reading.selectedSource.sourceName, "Portal B");
  assert.equal(result.reading.selectedSource.selection.reasons.historicalSuccessRate, 1);
});

test("reutiliza o texto extraído sem abrir novamente o portal", async () => {
  const topic = {
    id: "topic-cache",
    title: "Plano de mobilidade urbana",
    editoria: "Política",
    items: [
      { id: "a", kind: "portal", title: "Plano de mobilidade urbana", content: longParagraph, contentSource: "feed-content", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/cache" },
    ],
  };
  let cacheReads = 0;
  const result = await buildIntelligentCarousel(topic, {
    fetcher: async () => { throw new Error("o portal não deveria ser aberto"); },
    readCache: {
      get: async () => {
        cacheReads += 1;
        return {
          url: "https://portal-a.test/cache",
          sourceName: "Portal A",
          title: "Plano de mobilidade urbana",
          publishedAt: "2026-07-24T10:00:00Z",
          contentLevel: "article",
          extractionMethod: "json-ld",
          content: `${longParagraph} ${longParagraph}`,
        };
      },
    },
  });
  assert.equal(cacheReads, 1);
  assert.equal(result.reading.selectedSource.readMode, "full-article-cache");
  assert.equal(result.reading.selectedSource.cacheHit, true);
  assert.equal(result.reading.liveSuccessful, 1);
  assert.equal(result.cycle.nextCycleAllowed, true);
});

test("prioriza URL direta do portal em vez de link agregador", async () => {
  const topic = {
    id: "topic-url-direta",
    title: "Plano de mobilidade urbana avança",
    editoria: "Política",
    items: [
      {
        id: "agregada",
        kind: "portal",
        title: "Plano de mobilidade urbana avança",
        content: `${longParagraph} ${longParagraph}`,
        contentSource: "feed-content",
        sourceName: "Portal Agregado",
        publisherHomepageUrl: "https://portal-agregado.test",
        publishedAt: "2026-07-24T10:02:00Z",
        url: "https://news.google.com/rss/articles/agregada",
      },
      {
        id: "direta",
        kind: "portal",
        title: "Plano de mobilidade urbana avança",
        description: longParagraph,
        sourceName: "Portal Direto",
        publisherHomepageUrl: "https://portal-direto.test",
        publishedAt: "2026-07-24T10:00:00Z",
        url: "https://portal-direto.test/materia",
      },
    ],
  };
  const fetched = [];
  const result = await buildIntelligentCarousel(topic, {
    fetcher: async (url) => {
      fetched.push(String(url));
      return new Response(articleHtml("Plano de mobilidade urbana avança"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
  assert.deepEqual(fetched, ["https://portal-direto.test/materia"]);
  assert.equal(result.reading.selectedSource.sourceName, "Portal Direto");
  assert.equal(result.reading.selectedSource.selection.directPublisherUrl, true);
  assert.equal(result.reading.selectedSource.selection.reasons.aggregatorUrl, false);
});

test("tenta outra matéria publicada quando o primeiro portal bloqueia a leitura", async () => {
  const topic = {
    id: "topic-heartbeat",
    title: "Plano de mobilidade urbana",
    editoria: "Política",
    items: [
      {
        id: "materia-1", kind: "portal", title: "Plano de mobilidade urbana",
        content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content",
        sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/materia-1",
      },
      {
        id: "materia-2", kind: "portal", title: "Outro portal publica o plano de mobilidade",
        content: `${longParagraph} ${longParagraph}`, contentSource: "feed-content",
        sourceName: "Portal B", publishedAt: "2026-07-24T09:59:00Z", url: "https://portal-b.test/materia-2",
      },
    ],
  };
  const fetched = [];
  const progress = [];
  const result = await buildIntelligentCarousel(topic, {
    progressHeartbeatMs: 8,
    articleTimeoutMs: 250,
    onProgress: async (event) => progress.push(event),
    fetcher: async (url) => {
      fetched.push(String(url));
      if (String(url).includes("portal-a.test")) throw new Error("portal bloqueou a leitura");
      return new Response(articleHtml("Outro portal publica o plano de mobilidade"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
  assert.deepEqual(fetched, ["https://portal-a.test/materia-1", "https://portal-b.test/materia-2"]);
  assert.equal(result.reading.selectedSource.selectedArticleId, "materia-2");
  assert.equal(result.reading.selectedSource.readMode, "full-article");
  assert.equal(result.reading.publisherVerified, true);
  assert.equal(result.reading.requested, 2);
  assert.equal(result.reading.failed, 1);
  assert.ok(progress.some((event) => event.progress > 18 && event.progress < 60));
  assert.ok(progress.some((event) => event.progress === 60));
});

test("gera quantidade flexível de slides preservando 7 como padrão", async () => {
  const topic = {
    id: "topic-flexivel",
    title: "Plano de mobilidade urbana avança",
    editoria: "Política",
    items: [{
      id: "a",
      kind: "portal",
      title: "Plano de mobilidade urbana avança",
      content: `${longParagraph} ${longParagraph}`,
      contentSource: "feed-content",
      sourceName: "Portal A",
      publishedAt: "2026-07-24T10:00:00Z",
      url: "https://portal-a.test/flexivel",
    }],
  };
  const fetcher = async () => new Response(articleHtml(topic.title), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const compact = await buildIntelligentCarousel(topic, { fetcher, slideCount: 3 });
  const standard = await buildIntelligentCarousel(topic, { fetcher });
  assert.equal(compact.slides.length, 3);
  assert.equal(compact.slides.at(-1).role, "Conclusão");
  assert.equal(standard.slides.length, 7);
  await assert.rejects(
    buildIntelligentCarousel(topic, { fetcher, slideCount: 12 }),
    /evidências distintas|sem repetição|Reduza a quantidade de slides/i,
  );
});



test("remove repetição de informação entre slides mesmo quando a IA repete a mesma evidência", async () => {
  const article = [
    "O surto de ebola no Congo ultrapassou dois mil óbitos confirmados pelas autoridades de saúde.",
    "A variante Bundibugyo soma 4.566 casos confirmados desde o início da emergência.",
    "A Organização Mundial da Saúde informou que a transmissão acelerou nas últimas semanas.",
    "Equipes médicas ampliaram a vigilância epidemiológica e o atendimento nas áreas mais afetadas.",
    "Autoridades locais reforçaram medidas de isolamento e rastreamento de contatos.",
    "Pacientes graves podem apresentar manifestações hemorrágicas e comprometimento de diferentes órgãos.",
    "O governo afirma que novas equipes serão enviadas para ampliar a resposta ao surto.",
    "A OMS recomenda manter a identificação rápida de casos e o acompanhamento dos contatos próximos."
  ].join(" ");
  const topic = {
    id: "topic-ebola-diverso",
    title: "Ebola avança no Congo e supera 2 mil mortes",
    editoria: "Saúde",
    items: [{ id: "a", kind: "portal", title: "Ebola avança no Congo e supera 2 mil mortes", sourceName: "Portal Saúde", publishedAt: "2026-08-14T10:00:00Z", url: "https://portal-saude.test/ebola" }],
  };
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: topic.title, datePublished: "2026-08-14T10:00:00Z", articleBody: article })}</script></head><body><article><p>${article}</p></article></body></html>`;
  const ai = {
    run: async () => ({ response: { slides: Array.from({ length: 6 }, (_, index) => ({
      number: index + 1,
      role: index === 5 ? "CTA" : "Informação",
      title: index === 5 ? "Acompanhe" : "Ebola avança no Congo",
      subtitle: index === 5 ? "Acompanhe as atualizações." : "Ebola avança no Congo e supera 2 mil mortes.",
      evidenceIds: index === 5 ? [] : ["fact-1"],
    })) } }),
  };
  const result = await buildIntelligentCarousel(topic, {
    ai,
    slideCount: 6,
    fetcher: async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  const informative = result.slides.filter((slide) => slide.role !== "CTA");
  assert.equal(informative.length, 5);
  assert.equal(new Set(informative.map((slide) => slide.evidenceIds[0])).size, informative.length);
  assert.equal(result.validation.noRepeatedAngles, true);
  assert.equal(result.validation.passed, true);
  assert.ok(result.validation.issues.some((issue) => issue.code === "reused-primary-evidence" || issue.code === "repeated-slide" || issue.code === "title-repeats-subtitle"));
  for (let left = 0; left < informative.length; left += 1) {
    for (let right = left + 1; right < informative.length; right += 1) {
      assert.notEqual(informative[left].subtitle, informative[right].subtitle);
      assert.notEqual(informative[left].title, informative[right].title);
    }
  }
});


test("corrige texto concatenado e recusa fragmentos de tabela eleitoral", async () => {
  const article = [
    "A pesquisa Quaest divulgada nesta sexta-feira mostra Lula com 44% e Flávio Bolsonaro com 40% em uma simulação de segundo turno.",
    "O levantamento informa margem de erro de dois pontos percentuais para mais ou para menos.",
    "Em outro cenário, o senador aparece tecnicamente empatado com o presidente dentro da margem de erro.",
    "A pesquisa ouviu eleitores entre os dias 10 e 12 de agosto e foi registrada conforme as regras eleitorais.",
    "Na tabela publicada pelo portal constam os seguintes dados: Lula (PT): 44%Flávio Bolsonaro (PL): 40%Indecisos: 4%Branco/Nulo/Não vai votar: 12%.",
    "Os números apresentados pelo instituto descrevem as intenções de voto no período da coleta."
  ].join(" ");
  const topic = {
    id: "topic-pesquisa-coerente",
    title: "Quaest divulga novos números da disputa presidencial",
    editoria: "Política",
    items: [{ id: "a", kind: "portal", title: "Quaest divulga novos números da disputa presidencial", sourceName: "Portal Política", publishedAt: "2026-08-14T12:00:00Z", url: "https://portal-politica.test/pesquisa" }],
  };
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: topic.title, datePublished: "2026-08-14T12:00:00Z", articleBody: article })}</script></head><body><article><p>${article}</p></article></body></html>`;
  const ai = {
    run: async () => ({ response: { slides: [
      { number: 1, title: "13%Indecisos: 4%Lula X", subtitle: "44%Ronaldo CaiadoLula (PT): 44%", evidenceIds: ["fact-1"] },
      { number: 2, title: "para a Presidência", subtitle: "divulgada nesta sexta-feira, 14", evidenceIds: ["fact-1"] },
      { number: 3, title: "O que aconteceu", subtitle: "com intenções de voto que variam", evidenceIds: ["fact-1"] },
      { number: 4, title: "Os principais detalhes", subtitle: "já nas simulações de segundo turno, o senador", evidenceIds: ["fact-1"] },
      { number: 5, title: "Continue acompanhando", subtitle: "Acompanhe as próximas atualizações.", evidenceIds: [] },
    ] } }),
  };
  const result = await buildIntelligentCarousel(topic, {
    ai,
    slideCount: 5,
    fetcher: async () => new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  assert.equal(result.validation.passed, true);
  for (const slide of result.slides.filter((item) => item.role !== "CTA")) {
    assert.doesNotMatch(`${slide.title} ${slide.subtitle}`, /%[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]|[a-záàâãéêíóôõúç]{3,}[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,}/);
    assert.match(slide.subtitle, /[.!?]$/);
    assert.doesNotMatch(slide.subtitle, /\b(?:de|da|do|das|dos|para|por|com|sem|em|no|na|nos|nas|e|ou|que|como|entre|sobre)[.!?]?$/i);
  }
  assert.ok(result.validation.issues.some((issue) => issue.code === "incoherent-language" || issue.code === "reused-primary-evidence"));
});

test("perfil de escrita orienta o prompt sem alterar a fonte factual", async () => {
  const topic = {
    id: "topic-estilo",
    title: "Plano de mobilidade urbana avança",
    editoria: "Política",
    items: [{
      id: "a",
      kind: "portal",
      title: "Plano de mobilidade urbana avança",
      content: `${longParagraph} ${longParagraph}`,
      contentSource: "feed-content",
      sourceName: "Portal A",
      publishedAt: "2026-07-24T10:00:00Z",
      url: "https://portal-a.test/estilo",
    }],
  };
  const prompts = [];
  const ai = {
    run: async (_model, input) => {
      prompts.push(input.messages.map((message) => message.content).join("\n"));
      return { response: {
        questions: { whatHappened: longParagraph, who: "Prefeitura", where: "cidade", when: "2026", impact: longParagraph, repercussion: longParagraph },
        entities: { people: [], companies: [], places: [], dates: ["2026"], themes: ["política"], keywords: ["mobilidade"] },
        facts: [{ claim: "A prefeitura apresentou um plano de mobilidade urbana.", evidence: "A prefeitura apresentou um plano nacional de mobilidade urbana para reorganizar o transporte público", confidence: "high" }],
        slides: Array.from({ length: 5 }, (_, index) => ({
          number: index + 1,
          role: index === 4 ? "CTA" : "Informação",
          title: `Slide ${index + 1}`,
          subtitle: "A prefeitura apresentou um plano de mobilidade urbana para reorganizar o transporte público.",
          evidenceIds: ["fact-1"],
        })),
      } };
    },
  };
  const result = await buildIntelligentCarousel(topic, {
    ai,
    slideCount: 5,
    writingStyle: {
      prompt: "TOM: Conversacional e direto\nTÍTULOS: Ganchos curtos",
      profile: { tone: "Conversacional e direto", mode: "heuristic" },
      sampleCount: 3,
      updatedAt: "2026-08-05T12:00:00Z",
    },
    styleKey: "user-1:style-1",
    fetcher: async () => new Response(articleHtml(topic.title), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  assert.equal(result.slides.length, 5);
  assert.equal(result.writingProfile.active, true);
  assert.equal(result.writingProfile.sampleCount, 3);
  assert.match(prompts[0], /PERFIL DE ESCRITA DO USUÁRIO/);
  assert.match(prompts[0], /Conversacional e direto/);
  assert.match(prompts[0], /não use conhecimento externo|fatos/i);
});
