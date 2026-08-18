import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const index = await read("src/index.js");
const collector = await read("src/collector.js");
const youtube = await read("src/youtube.js");
const profile = await read("src/profile.js");
const articleReader = await read("src/article-reader.js");
const html = await read("public/index.html");
const app = await read("public/app.js");
const headers = await read("public/_headers");
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
assert.match(wranglerText, /YOUTUBE_JOBS_QUEUE/);
assert.match(wranglerText, /YOUTUBE_DB/);
assert.match(wranglerText, /ronda-editorial-youtube-jobs/);
assert.match(wranglerText, /dead_letter_queue/);
assert.match(index, /\/api\/status/);
assert.match(index, /\/api\/sources\/diagnostics/);
assert.match(index, /\/api\/youtube\/status/);
assert.match(index, /\/api\/youtube\/latest/);
assert.match(index, /\/api\/youtube\/collect/);
assert.match(index, /\/api\/newsroom/);
assert.match(index, /\/api\/youtube\/channels/);
assert.match(index, /syncNewsroomStories/);
assert.match(youtube, /collectYouTubeCuratedChannels/);
assert.match(youtube, /resolveYouTubeChannel/);
assert.match(index, /processYouTubeQueueMessage/);
assert.match(index, /\/api\/auth\/register/);
assert.match(index, /\/api\/auth\/login/);
assert.match(index, /\/api\/profile\/samples/);
assert.match(index, /\/api\/profile\/style\/rebuild/);
assert.match(index, /\/api\/profile\/carousel-learning/);
assert.match(profile, /MAX_CAROUSEL_LEARNING_EXAMPLES = 24/);
assert.match(profile, /summarizeCarouselLearning/);
assert.match(articleReader, /repairAiCarouselFromEvidence/);
assert.match(articleReader, /incoherent-language/);
assert.match(app, /approveCarouselLearning/);
assert.match(html, /id="approveCarouselLearning"/);
assert.match(index, /validateSlideCount/);
assert.match(profile, /PBKDF2/);
assert.match(profile, /MAX_STYLE_SAMPLES = 8/);
assert.match(profile, /MIN_SLIDE_COUNT = 3/);
assert.match(profile, /MAX_SLIDE_COUNT = 15/);
assert.match(articleReader, /source-evidence-v8-coherent-grounded-adaptive/);
assert.match(articleReader, /reused-primary-evidence/);
assert.match(articleReader, /title-repeats-subtitle/);
assert.match(articleReader, /INSUFFICIENT_DISTINCT_EVIDENCE/);
assert.match(articleReader, /noRepeatedAngles/);
assert.match(articleReader, /runAiCarouselFromEvidence/);
assert.match(articleReader, /publisherArticleVerified/);
assert.match(articleReader, /PUBLISHER_ARTICLE_UNAVAILABLE/);
assert.match(articleReader, /factsGeneratedByAi: false/);
assert.doesNotMatch(articleReader, /feed-content-fast/);
assert.match(articleReader, /carouselSlidePlan/);
assert.match(index, /activeRunStatus/);
assert.match(index, /expireStaleRuns/);
assert.match(index, /status: "queued"/);
assert.match(app, /If-None-Match/);
assert.match(app, /document\.hidden \? 5 \* 60_000 : 60_000/);
assert.match(collector, /runPool\(due, 5/);
assert.match(collector, /summarizePortalStatuses/);
assert.match(index, /round_failed_final/);
assert.match(index, /failure\.roundPayload = payload/);
assert.match(index, /lastAttempt/);
assert.match(app, /attemptDiagnostics/);
assert.match(app, /Última tentativa falhou/);
assert.match(youtube, /collectYouTubeTrending/);
assert.match(youtube, /collectYouTubeTerm/);
assert.match(youtube, /YOUTUBE_CHANNEL_SCOPE = "news_only"/);
assert.match(youtube, /APPROVED_YOUTUBE_NEWS_CHANNELS/);
assert.match(youtube, /filterYouTubeNewsVideos/);
assert.match(youtube, /YOUTUBE_NEWS_CATEGORY_ID = "25"/);
assert.match(youtube, /videoCategoryId: YOUTUBE_NEWS_CATEGORY_ID/);
assert.match(youtube, /restrictYouTubeCollectionToNews/);
assert.match(youtube, /videos:batchGetStats/);
assert.match(await read("src/database.js"), /compactYouTubeCollectionForStorage/);
assert.match(await read("src/database.js"), /emergencyDatabaseCleanup/);
assert.match(html, /id="navYouTube"/);
assert.match(html, /id="navNewsroom"/);
assert.match(html, /id="newsroomView"/);
assert.match(html, /id="youtubeCurationForm"/);
assert.match(html, /id="navProfile"/);
assert.match(html, /id="profileView"/);
assert.match(html, /id="carouselSlideCount"/);
assert.match(html, /id="youtubeView"/);
assert.match(headers, /i\.ytimg\.com/);
assert.doesNotMatch(html, /<canvas|youtube-chart|youtubeChart/i);
assert.match(app, /loadYouTubeLatest/);
assert.match(app, /collectYouTubeNow/);
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
  "migrations/0004_youtube_integration.sql",
  "migrations/0005_d1_storage_guard.sql",
  "migrations/0006_user_profiles_and_flexible_carousels.sql",
  "migrations/0007_core_storage_rescue_and_youtube_split.sql",
  "migrations/0008_carousel_editorial_learning.sql",
  "migrations/0009_newsroom_workflow.sql",
  "migrations_youtube/0002_curated_news_channels.sql",
  "migrations_youtube/0001_youtube_database.sql",
  "RECUPERAR-D1-AGORA.sql",
  "src/youtube.js",
  "src/profile.js",
  "public/_headers",
]) {
  await access(new URL(required, root));
}

console.log(`Release ${packageJson.version} validado.`);
