import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const index = await read("src/index.js");
const collector = await read("src/collector.js");
const html = await read("public/index.html");
const app = await read("public/app.js");
const wranglerText = await read("wrangler.jsonc");
const wrangler = JSON.parse(wranglerText);

assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[""].version, packageJson.version);
assert.match(index, new RegExp(`const VERSION = ["']${packageJson.version.replaceAll(".", "\\.")}["']`));
assert.ok(html.includes(`/app.js?v=${packageJson.version}`));
assert.ok(html.includes(`/styles.css?v=${packageJson.version}`));
assert.equal(wrangler.assets?.directory, "./public");
assert.deepEqual(wrangler.assets?.run_worker_first, ["/api/*"]);
assert.equal(wrangler.minify, true);
assert.equal(wrangler.keep_names, false);
assert.match(wranglerText, /ROUND_JOBS_QUEUE/);
assert.match(wranglerText, /dead_letter_queue/);
assert.match(index, /\/api\/status/);
assert.match(index, /\/api\/sources\/diagnostics/);
assert.match(index, /activeRunStatus/);
assert.match(index, /expireStaleRuns/);
assert.match(index, /status: "queued"/);
assert.match(app, /If-None-Match/);
assert.match(app, /document\.hidden \? 5 \* 60_000 : 60_000/);
assert.match(collector, /runPool\(due, 5/);
for (const removedId of [
  "fatos-desconhecidos", "mega-curioso", "incrivel-club", "misterios-do-mundo",
  "canaltech-curiosidades", "superinteressante", "revista-galileu",
  "segredos-do-mundo", "awebic",
]) {
  assert.ok(!collector.includes(`portalFeed("${removedId}"`) && !collector.includes(`sharedGooglePortalFeed("${removedId}"`));
}
assert.doesNotMatch(app, /custom-sources|customSourceForm|api\/custom-sources/);

for (const required of [
  "CHANGELOG.md",
  ".github/workflows/ci.yml",
  "migrations/0001_v2_5_0.sql",
  "migrations/0002_remove_curiosity_sources.sql",
  "migrations/0003_round_state_machine.sql",
  "public/_headers",
]) {
  await access(new URL(required, root));
}

console.log(`Release ${packageJson.version} validado.`);
