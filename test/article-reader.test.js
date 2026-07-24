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

test("lê as matérias, usa fallback do feed e gera sete slides com título e subtítulo", async () => {
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
  const ai = {
    run: async () => ({ response: {
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
    } }),
  };

  const result = await buildIntelligentCarousel(topic, { ai, fetcher });
  assert.equal(externalFetches, 2);
  assert.equal(result.analysisMode, "ai");
  assert.equal(result.reading.basis, "live-article-with-feed-fallback");
  assert.equal(result.reading.successful, 2);
  assert.equal(result.reading.liveSuccessful, 1);
  assert.equal(result.reading.fallbackSources, 1);
  assert.equal(result.reading.blockedSources, 1);
  assert.ok(result.reading.totalWords > 100);
  assert.equal(result.slides.length, 7);
  assert.ok(result.slides.every((slide) => slide.title && slide.subtitle && slide.body === slide.subtitle));
  assert.deepEqual(result.slides.map((slide) => slide.role), ["Título principal", "Contexto", "Informação principal", "Detalhamento", "Consequência", "Conclusão", "CTA"]);
  assert.equal(result.questions.where, "Brasil.");
  assert.equal(result.verificationLinks.length, 3);
  assert.ok(result.reading.sources.every((source) => !("content" in source)));
});

test("gera roteiro preliminar mesmo quando a ronda possui apenas títulos", async () => {
  const topic = {
    id: "topic-limitado",
    title: "Assunto em desenvolvimento",
    editoria: "Notícias",
    items: [
      { id: "a", kind: "portal", title: "Primeira atualização do assunto", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/a" },
      { id: "b", kind: "portal", title: "Nova informação é divulgada", sourceName: "Portal B", publishedAt: "2026-07-24T09:50:00Z", url: "https://portal-b.test/b" },
    ],
  };
  const result = await buildIntelligentCarousel(topic, { fetcher: async () => { throw new Error("bloqueado"); } });
  assert.equal(result.reading.quality, "limited");
  assert.equal(result.reading.liveSuccessful, 0);
  assert.equal(result.reading.fallbackSources, 2);
  assert.equal(result.slides.length, 7);
  assert.match(result.disclaimer, /preliminar/i);
});

test("avança o progresso por fonte e não trava quando um portal demora", async () => {
  const topic = {
    id: "topic-multifonte",
    title: "Assunto acompanhado por vários portais",
    editoria: "Notícias",
    items: [
      { id: "a", kind: "portal", title: "Portal A publica a informação principal", description: "Informação principal confirmada pelo primeiro portal.", sourceName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/a" },
      { id: "b", kind: "portal", title: "Portal B detalha o assunto", description: "O segundo portal apresenta contexto e detalhes adicionais.", sourceName: "Portal B", publishedAt: "2026-07-24T09:59:00Z", url: "https://portal-b.test/b" },
      { id: "c", kind: "portal", title: "Portal C repercute a notícia", description: "O terceiro portal registra a repercussão do acontecimento.", sourceName: "Portal C", publishedAt: "2026-07-24T09:58:00Z", url: "https://portal-c.test/c" },
      { id: "d", kind: "portal", title: "Portal D acompanha os desdobramentos", description: "O quarto portal acompanha os próximos passos.", sourceName: "Portal D", publishedAt: "2026-07-24T09:57:00Z", url: "https://portal-d.test/d" },
    ],
  };
  let active = 0;
  let maxActive = 0;
  const fetcher = async (url, options = {}) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      if (String(url).includes("portal-a.test")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(articleHtml("Portal A publica a informação principal"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (String(url).includes("portal-b.test")) throw new Error("bloqueado pelo portal");
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        options.signal?.addEventListener?.("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        }, { once: true });
      });
      throw new Error("resposta lenta");
    } finally {
      active -= 1;
    }
  };
  const progress = [];
  const startedAt = Date.now();
  const result = await buildIntelligentCarousel(topic, {
    fetcher,
    articleTimeoutMs: 80,
    readingConcurrency: 2,
    onProgress: async (event) => progress.push(event),
  });
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 1_500, `processamento demorou ${elapsed}ms`);
  assert.ok(maxActive <= 2);
  assert.equal(result.reading.successful, 4);
  assert.equal(result.reading.liveSuccessful, 1);
  assert.equal(result.reading.fallbackSources, 3);
  assert.ok(progress.some((event) => event.progress > 8 && event.progress <= 60));
  assert.ok(progress.filter((event) => event.stage === "reading").length >= 5);
  assert.match(progress.findLast((event) => event.stage === "reading")?.message || "", /Leitura 4 de 4/);
  assert.equal(result.slides.length, 7);
});
