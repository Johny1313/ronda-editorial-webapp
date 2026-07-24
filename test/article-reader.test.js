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

test("lê matérias completas e gera os sete slides com IA estruturada", async () => {
  const topic = {
    id: "topic-mobilidade",
    title: "Congresso aprova plano de mobilidade urbana",
    editoria: "Política",
    items: [
      { id: "a", kind: "portal", title: "Congresso aprova plano", sourceName: "Portal A", collectorName: "Portal A", publishedAt: "2026-07-24T10:00:00Z", url: "https://portal-a.test/materia" },
      { id: "b", kind: "portal", title: "Plano prevê investimentos", sourceName: "Portal B", collectorName: "Portal B", publishedAt: "2026-07-24T09:50:00Z", url: "https://portal-b.test/materia" },
      { id: "c", kind: "social", title: "Plano repercute entre especialistas", sourceName: "Jornalista", publishedAt: "2026-07-24T10:05:00Z", url: "https://bsky.app/profile/test/post/abc", interactions: 30 },
    ],
  };
  const fetcher = async (url) => new Response(articleHtml(url.includes("portal-a") ? "Congresso aprova plano" : "Plano prevê investimentos"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
      slides: Array.from({ length: 7 }, (_, index) => ({ number: index + 1, role: `Papel ${index + 1}`, title: `Título ${index + 1}`, body: `Corpo factual do slide ${index + 1}.` })),
    } }),
  };

  const result = await buildIntelligentCarousel(topic, { ai, fetcher });
  assert.equal(result.analysisMode, "ai");
  assert.equal(result.reading.successful, 2);
  assert.ok(result.reading.totalWords > 240);
  assert.equal(result.slides.length, 7);
  assert.deepEqual(result.slides.map((slide) => slide.role), ["Título principal", "Contexto", "Informação principal", "Detalhamento", "Consequência", "Conclusão", "CTA"]);
  assert.equal(result.questions.where, "Brasil.");
  assert.ok(result.verificationLinks.length === 3);
  assert.ok(result.reading.sources.every((source) => !("content" in source)));
});
