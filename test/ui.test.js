import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("link de apuração não compartilha a classe dos botões primários", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /primary-source/);
  assert.doesNotMatch(app, /primary \? "primary" : "source"/);
  assert.match(css, /\.primary-source,\.source\{/);
  assert.doesNotMatch(css, /\.primary,\.source\{/);
  assert.match(app, /Abrir para apuração/);
});


test("interface não oferece cadastro manual de sites", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /navCustomSources|customSourcesView|Cadastrar site/);
  assert.doesNotMatch(app, /custom-sources|customSourceForm|api\/custom-sources/);
});


test("aba YouTube mantém a UX da Ronda e não usa gráficos", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="navYouTube"/);
  assert.match(html, /id="youtubeView"/);
  assert.match(html, /Assuntos em destaque/);
  assert.match(html, /Vídeos em atenção/);
  assert.match(html, /Quem está puxando audiência/);
  assert.doesNotMatch(html, /<canvas|youtube-chart|youtubeChart/i);
  assert.match(app, /\/api\/youtube\/latest/);
  assert.match(app, /collectYouTubeNow/);
  assert.match(css, /\.youtube-card/);
});

test("perfil editorial permite cadastro, exemplos de escrita e slides flexíveis", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="navProfile"/);
  assert.match(html, /id="profileView"/);
  assert.match(html, /id="registerEmail"/);
  assert.match(html, /id="writingSampleForm"/);
  assert.match(html, /id="carouselSlideCount"/);
  assert.match(app, /\/api\/auth\/\$\{mode\}/);
  assert.match(app, /\/api\/profile\/samples/);
  assert.match(app, /slideCountOptions/);
  assert.match(app, /slideCount/);
  assert.match(css, /\.profile-workspace-grid/);
  assert.match(css, /\.carousel-setup/);
});


test("painel preserva a última ronda válida e mostra diagnóstico da tentativa com falha", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /attemptDiagnostics/);
  assert.match(app, /Última tentativa falhou/);
  assert.match(app, /dados da ronda válida preservados/);
  assert.match(app, /roundDiagnosticsSummary/);
  assert.match(app, /lastValidRoundLabel/);
});


test("carrossel só alimenta memória editorial após aprovação explícita", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="approveCarouselLearning"/);
  assert.match(app, /approveCarouselLearning/);
  assert.match(app, /\/api\/profile\/carousel-learning/);
  assert.doesNotMatch(app, /automaticLearning|autoLearnGeneratedCarousel/);
});


test("home não expõe chips de veículos clicáveis e oferece Mostrar tudo", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="clearAllFilters"[^>]*>Mostrar tudo</);
  assert.match(app, /function resetRoundFilters\(/);
  assert.match(app, /source-health-link/);
  assert.doesNotMatch(app, /class="source-badge" data-portal/);
  assert.doesNotMatch(app, /class="source-name-button" data-portal/);
  assert.match(app, /operacionais/);
});
