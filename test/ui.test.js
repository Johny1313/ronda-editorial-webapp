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
