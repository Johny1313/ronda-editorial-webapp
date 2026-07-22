import { Miniflare } from "miniflare";

const publishedAt = new Date().toUTCString();
const createdAt = new Date().toISOString();

async function mockExternalSource(request) {
  const url = new URL(request.url);
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
  scriptPath: new URL("../dist/cloudflare-worker-unico.js", import.meta.url).pathname,
  compatibilityDate: "2026-07-22",
  bindings: { ENVIRONMENT: "test" },
  d1Databases: { DB: `ronda-smoke-${crypto.randomUUID()}` },
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
  assert(html.includes('id="sourcesView"') && html.includes('id="sourcePortalGrid"'), "Tela de Fontes não foi incorporada ao Worker.");
  assert(home.headers.get("content-security-policy"), "CSP ausente no dashboard.");

  const selfTest = await getJson("/api/self-test");
  assert(selfTest.body.ok && selfTest.body.database?.readWriteDelete, "Autoteste lógico/D1 falhou.");

  const round = await getJson("/api/round", { method: "POST" });
  assert(round.response.status === 202 && round.body.runId, "Ronda simulada não foi iniciada em segundo plano.");
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

  const history = await getJson("/api/history?limit=10");
  assert(history.body.runs.some((run) => run.id === round.body.runId && run.status === "success"), "Histórico D1 não registrou a ronda.");

  const health = await getJson("/api/health");
  assert(health.body.ready && health.body.schedulerHealthy, "Saúde do serviço não reconheceu a ronda.");

  process.stdout.write(
    `Smoke test aprovado: dashboard, D1, ${roundData.totals.items} conteúdos, ${roundData.totals.topics} assuntos e Bluesky.\n`,
  );
} finally {
  await mf.dispose();
}
