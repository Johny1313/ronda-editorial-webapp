const STORAGE_TOKEN = "ronda-editorial-operation-token-v1";
const state = {
  data: null,
  health: null,
  query: "",
  period: 1440,
  source: "Todos",
  region: "Todas",
  editoria: "Todas",
  portal: null,
  view: "round",
  expanded: new Set(),
  running: false,
  lastRunId: null,
  carouselText: "",
};

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const runButton = document.getElementById("runRound");
const grid = document.getElementById("topicsGrid");
const liveDot = document.getElementById("liveDot");
const statusLabel = document.getElementById("statusLabel");
const statusSub = document.getElementById("statusSub");
const roundView = document.getElementById("roundView");
const sourcesView = document.getElementById("sourcesView");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function metricValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? numberFormat.format(value) : "Não disponível";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date).replace(",", "") : "Data não informada";
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;
}

function setStatus(type, label, sub) {
  liveDot.className = `live ${type || ""}`;
  statusLabel.textContent = label;
  statusSub.textContent = sub;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || `Falha HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function itemMatchesSource(item) {
  const matchesType = state.source === "Todos" || (state.source === "Portal" ? item.kind === "portal" : item.kind === "social");
  const matchesPortal = !state.portal || item.collectorName === state.portal || item.sourceName === state.portal;
  const matchesRegion = state.region === "Todas" || item.region === state.region;
  return matchesType && matchesPortal && matchesRegion;
}

function itemWithinPeriod(item) {
  const age = (Date.now() - Date.parse(item.publishedAt)) / 60_000;
  return Number.isFinite(age) && age >= -5 && age <= state.period;
}

function sourceMarkup(item, primary = false) {
  const platform = item.platform || (item.kind === "portal" ? "Portal" : "Rede");
  const metrics = [`<span>Views: <strong>${metricValue(item.views)}</strong></span>`];
  if (item.kind === "social") metrics.push(`<span>Comentários: <strong>${metricValue(item.comments)}</strong></span>`);
  return `<div class="${primary ? "primary" : "source"}"><div><div class="kicker"><span class="kind ${escapeHtml(platform.toLowerCase())}">${escapeHtml(platform)}</span><button class="source-name-button" data-portal="${escapeHtml(item.collectorName || item.sourceName)}" type="button" title="Mostrar somente esta fonte">${escapeHtml(item.sourceName)}</button><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class="source-footer"><div class="source-metrics">${metrics.join("")}</div><a class="open" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir para apuração ↗</a></div></div></div>`;
}

function sourceInitials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function sourceRegion(source) {
  return source?.region || (source?.name === "Bluesky" ? "Rede" : "Brasil");
}

function portalCardMarkup(source) {
  const available = source.ok && Number(source.count) > 0;
  const portalAttribute = available ? `data-portal="${escapeHtml(source.name)}"` : "disabled";
  const detail = available
    ? `${Number(source.count)} ${Number(source.count) === 1 ? "conteúdo recolhido" : "conteúdos recolhidos"}${source.fallback ? " · rota alternativa" : ""}`
    : source.ok ? "Nenhuma notícia recente" : "Fonte indisponível nesta ronda";
  return `<button class="portal-card ${source.ok ? "ok" : "error"}${state.portal === source.name ? " selected" : ""}" ${portalAttribute} type="button"><span class="portal-icon">${escapeHtml(sourceInitials(source.name))}</span><span class="portal-card-copy"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(detail)}</small></span><span class="portal-state">${available ? "Ver notícias →" : "Sem coleta"}</span></button>`;
}

function renderPortalCards() {
  const holder = document.getElementById("sourcePortalGrid");
  const sources = state.data?.sources || [];
  if (!sources.length) {
    holder.innerHTML = '<div class="empty sources-empty"><strong>Nenhuma fonte consultada ainda</strong><span>Execute uma ronda para carregar os portais.</span></div>';
    return;
  }
  holder.innerHTML = ["Brasil", "Mundo", "Rede"].map((region) => {
    const regionalSources = sources.filter((source) => sourceRegion(source) === region);
    if (!regionalSources.length) return "";
    const label = region === "Rede" ? "Complemento social" : region;
    const available = regionalSources.filter((source) => source.ok && Number(source.count) > 0).length;
    return `<section class="source-region-group"><div class="source-region-heading"><h3>${escapeHtml(label)}</h3><span>${available}/${regionalSources.length} ${regionalSources.length === 1 ? "fonte disponível" : "fontes disponíveis"}</span></div><div class="source-region-grid">${regionalSources.map(portalCardMarkup).join("")}</div></section>`;
  }).join("");
}

function renderSourceHealth(message = "", warning = false) {
  const holder = document.getElementById("sourceHealth");
  if (message) {
    holder.innerHTML = `<span class="health-message ${warning ? "warn" : ""}">${escapeHtml(message)}</span>`;
    return;
  }
  const sources = state.data?.sources || [];
  if (!sources.length) {
    holder.innerHTML = '<span class="health-label">Fontes ainda não consultadas</span>';
    return;
  }
  const portals = sources.filter((source) => sourceRegion(source) !== "Rede");
  const okCount = portals.filter((source) => source.ok && Number(source.count) > 0).length;
  holder.innerHTML = `<span class="health-label">Portais ${okCount}/${portals.length}</span>${["Brasil", "Mundo", "Rede"].map((region) => {
    const regionalSources = sources.filter((source) => sourceRegion(source) === region);
    if (!regionalSources.length) return "";
    return `<span class="health-region">${escapeHtml(region)}</span>${regionalSources.map((source) => {
      const available = source.ok && Number(source.count) > 0;
      const portalAttribute = available ? `data-portal="${escapeHtml(source.name)}"` : "disabled";
      const title = source.error || (available ? `Mostrar somente os ${source.count} conteúdos recolhidos de ${source.name}${source.fallback ? " por rota alternativa" : ""}` : `Nenhum conteúdo recente de ${source.name}`);
      const status = available ? `${source.count}${source.fallback ? " alt." : ""}` : source.ok ? "0" : "falhou";
      return `<button class="health-chip ${source.ok ? "ok" : "error"}${state.portal === source.name ? " selected" : ""}" ${portalAttribute} type="button" aria-pressed="${state.portal === source.name}" title="${escapeHtml(title)}"><span class="health-icon">${escapeHtml(sourceInitials(source.name))}</span>${escapeHtml(source.name)} · ${escapeHtml(status)}</button>`;
    }).join("")}`;
  }).join("")}`;
}

function setSourceSegment(value) {
  state.source = value;
  document.querySelectorAll("#sourceFilter button").forEach((button) => button.classList.toggle("active", button.dataset.value === value));
}

function setRegionSegment(value) {
  state.region = value;
  document.querySelectorAll("#regionFilter button").forEach((button) => button.classList.toggle("active", button.dataset.value === value));
}

function updatePortalFilter() {
  const holder = document.getElementById("portalFilter");
  holder.hidden = !state.portal;
  document.getElementById("portalFilterName").textContent = state.portal || "";
}

function showView(view) {
  state.view = view;
  roundView.hidden = view !== "round";
  sourcesView.hidden = view !== "sources";
  document.getElementById("navRound").classList.toggle("active", view === "round");
  document.getElementById("navSources").classList.toggle("active", view === "sources");
  if (view === "sources") renderPortalCards();
}

function filterByPortal(name) {
  state.portal = name || null;
  const matchingItem = (state.data?.items || []).find((item) => item.collectorName === name || item.sourceName === name);
  const matchingSource = (state.data?.sources || []).find((source) => source.name === name);
  setSourceSegment(name ? (name === "Bluesky" || matchingItem?.kind === "social" ? "Rede" : "Portal") : "Todos");
  setRegionSegment(name && sourceRegion(matchingSource) !== "Rede" ? sourceRegion(matchingSource) : "Todas");
  state.expanded.clear();
  showView("round");
  updatePortalFilter();
  renderSourceHealth();
  renderPortalCards();
  render();
  document.querySelector(".controls").scrollIntoView({ behavior: "smooth", block: "start" });
}

function render() {
  const topics = state.data?.topics || [];
  const query = state.query.trim().toLocaleLowerCase("pt-BR");
  const visible = topics
    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))
    .filter((topic) => topic.items.length && (state.editoria === "Todas" || (topic.editoria || "Notícias") === state.editoria) && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(" ")}`.toLocaleLowerCase("pt-BR").includes(query)));

  document.getElementById("summaryTopics").textContent = visible.length;
  document.getElementById("summaryContents").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);
  document.getElementById("summaryChannels").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;
  document.getElementById("summaryUrgent").textContent = visible.filter((topic) => topic.tone === "urgent").length;
  updatePortalFilter();

  if (!state.data) {
    grid.innerHTML = '<div class="empty"><strong>Nenhuma ronda disponível</strong><span>A primeira coleta será executada pelo agendamento online ou pelo botão Executar ronda.</span></div>';
    return;
  }
  if (!visible.length) {
    grid.innerHTML = '<div class="empty"><strong>Nenhum assunto neste filtro</strong><span>Retire um filtro ou aguarde uma nova ronda.</span></div>';
    return;
  }

  grid.innerHTML = visible.map((topic) => {
    const items = [...topic.items].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    const primary = items.find((item) => item.kind === "portal") || items[0];
    const additional = items.filter((item) => item.id !== primary.id);
    const sources = [...new Set(items.map((item) => item.sourceName))];
    const views = items.reduce((sum, item) => sum + (Number(item.views) || 0), 0);
    const comments = items.reduce((sum, item) => sum + (Number(item.comments) || 0), 0);
    const latest = items[0].publishedAt;
    const open = state.expanded.has(topic.id);
    const editoria = topic.editoria || "Notícias";
    const carousel = topic.carousel || {};
    return `<article class="card ${escapeHtml(topic.tone)}"><div class="accent"></div><div class="card-body"><div class="topline"><div class="topic-labels"><span class="priority"><i></i>${escapeHtml(topic.priority)}</span><span class="editoria-badge">${escapeHtml(editoria)}</span></div><span class="score">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class="card-sources"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<button class="source-badge" data-portal="${escapeHtml(source)}" type="button" title="Filtrar por ${escapeHtml(source)}">${escapeHtml(source)}</button>`).join("")}${sources.length > 6 ? `<span class="source-badge">+${sources.length - 6}</span>` : ""}</div><div class="published"><span>Última postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class="relative">${escapeHtml(relativeTime(latest))}</span></div><div class="metrics"><div class="metric"><span>Visualizações observadas</span><strong>${metricValue(views)}</strong></div><div class="metric"><span>Comentários</span><strong>${metricValue(comments)}</strong></div><div class="metric"><span>Fontes diferentes</span><strong>${sources.length}</strong></div><div class="metric"><span>Conteúdos</span><strong>${items.length}</strong></div></div><div class="momentum"><span class="trend">↗</span><span>${escapeHtml(topic.momentum)}</span><span class="calculated">calculado nesta ronda</span></div><div class="recommendation"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || "Confirmar as informações nas fontes originais antes de publicar.")}</div><div class="carousel-teaser"><div><span>Tom de voz</span><strong>${escapeHtml(carousel.voiceTone || "Informativo e objetivo")}</strong></div><div><span>Modelo de post</span><strong>${escapeHtml(carousel.postModel || "Resumo factual em 5 cards")}</strong></div><button data-carousel-topic="${escapeHtml(topic.id)}" type="button">Ver roteiro do carrossel →</button></div>${sourceMarkup(primary, true)}${additional.length ? `<button class="toggle" data-toggle="${escapeHtml(topic.id)}" aria-expanded="${open}" type="button"><span>${open ? "Ocultar outros conteúdos" : `Ver mais ${additional.length} ${additional.length === 1 ? "conteúdo" : "conteúdos"}`}</span><span>${open ? "⌃" : "⌄"}</span></button>` : ""}${open ? `<div class="source-list">${additional.map((item) => sourceMarkup(item)).join("")}</div>` : ""}</div></article>`;
  }).join("");

  grid.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggle;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
  }));
}

function applyRound(payload) {
  if (!payload?.ok || !Array.isArray(payload.topics)) return;
  state.data = payload;
  state.lastRunId = payload.runId || state.lastRunId;
  state.expanded.clear();
  document.getElementById("lastUpdate").textContent = `Última coleta: ${formatDate(payload.collectedAt)}`;
  renderSourceHealth();
  renderPortalCards();
  render();
}

async function loadLatest({ quiet = false } = {}) {
  try {
    const response = await api(`/api/latest?t=${Date.now()}`);
    const payload = response?.data;
    if (payload?.ok && (!state.lastRunId || payload.runId !== state.lastRunId)) applyRound(payload);
    return payload;
  } catch (error) {
    if (!quiet) renderSourceHealth(error.message);
    return null;
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.hidden = false;
  const input = modal.querySelector("input");
  if (input) setTimeout(() => input.focus(), 0);
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

function operationToken() {
  try { return localStorage.getItem(STORAGE_TOKEN) || ""; } catch { return ""; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(attempt === 0 ? 1_000 : 2_500);
    try {
      const payload = await api(`/api/runs/${encodeURIComponent(runId)}?t=${Date.now()}`);
      const run = payload?.run;
      if (run?.status === "success") return run;
      if (run?.status === "failed") throw new Error(run.error || "A coleta não encontrou conteúdo válido.");
      setStatus("", "Ronda em andamento", `Coletando fontes… ${Math.min(99, 5 + attempt * 3)}%`);
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw new Error("A ronda continua no servidor. O painel será atualizado automaticamente quando ela terminar.");
}

async function executeRound(automatic = false) {
  if (state.running) return;
  const token = operationToken();
  if (state.health?.manualAuthRequired && !token) {
    document.getElementById("tokenMessage").textContent = "Informe a chave configurada no Worker para executar manualmente.";
    openModal("settingsModal");
    return;
  }
  state.running = true;
  runButton.disabled = true;
  runButton.classList.add("loading");
  runButton.innerHTML = "<span>↻</span>Coletando fontes…";
  setStatus("", "Ronda em andamento", "Consultando portais e fontes sociais");
  try {
    const payload = await api("/api/round", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) },
      body: JSON.stringify({ source: automatic ? "initial" : "button" }),
    });
    if (!payload?.runId && payload?.data?.ok) {
      applyRound(payload.data);
      const legacyTime = payload.data.collectedAt || payload.data.storedAt || new Date().toISOString();
      setStatus("ok", "Ronda concluída", `Coleta finalizada às ${new Date(legacyTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
      return;
    }
    if (!payload?.runId) throw new Error("O servidor retornou uma resposta de ronda incompatível. Publique todos os arquivos da mesma versão.");
    setStatus("", "Ronda iniciada", "O servidor está consultando os portais");
    await waitForRun(payload.runId);
    const completed = await loadLatest();
    if (!completed?.ok) throw new Error("A ronda terminou, mas o resultado ainda não foi carregado.");
    const completedAt = completed.collectedAt || completed.storedAt || new Date().toISOString();
    setStatus("ok", "Ronda concluída", `Coleta finalizada às ${new Date(completedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
  } catch (error) {
    if (error.status === 401) {
      document.getElementById("tokenMessage").textContent = "Chave incorreta. Confira a variável MANUAL_ROUND_TOKEN.";
      openModal("settingsModal");
    }
    const locked = error.status === 409 || error.status === 429;
    const pending = error.message.startsWith("A ronda continua no servidor");
    setStatus(locked || pending ? "warn" : "error", pending ? "Ronda ainda em andamento" : locked ? "Ronda já em andamento" : "Falha ao executar a ronda", error.message);
    if (!pending) renderSourceHealth(error.message, locked);
  } finally {
    state.running = false;
    runButton.disabled = false;
    runButton.classList.remove("loading");
    runButton.innerHTML = "<span>↻</span>Executar ronda";
  }
}

async function checkHealth() {
  try {
    const health = await api(`/api/health?t=${Date.now()}`);
    if (!health || typeof health !== "object" || !health.version) throw new Error("A versão publicada do Worker não é compatível com este painel.");
    state.health = health;
    const translationReady = health.translation?.ready !== false;
    document.getElementById("automationText").textContent = !translationReady
      ? "Automação ativa; tradução internacional indisponível no Cloudflare."
      : health.schedulerHealthy
      ? "Automação online ativa e atualizada."
      : health.lastSuccessAt
        ? "Automação online configurada; a última ronda está atrasada."
        : "Serviço online pronto; aguardando a primeira ronda.";
    setStatus(health.schedulerHealthy && translationReady ? "ok" : "warn", !translationReady ? "Tradução não configurada" : health.schedulerHealthy ? "Serviço online" : "Aguardando automação", !translationReady ? "O conteúdo internacional será ocultado" : health.lastSuccessAt ? `Última ronda ${relativeTime(health.lastSuccessAt)}` : "Execute a primeira ronda");
    return true;
  } catch (error) {
    state.health = null;
    setStatus("error", "Webapp não configurado", error.message);
    renderSourceHealth(error.message);
    document.getElementById("automationText").textContent = "Configuração incompleta no Cloudflare.";
    return false;
  }
}

async function showHistory() {
  openModal("historyModal");
  const holder = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const back = document.getElementById("historyBack");
  holder.hidden = false;
  detail.hidden = true;
  back.hidden = true;
  holder.innerHTML = '<div class="loading-row">Carregando histórico…</div>';
  try {
    const payload = await api("/api/history?limit=50");
    const runs = payload?.runs || [];
    holder.innerHTML = runs.length ? runs.map((run) => `<button class="history-row" data-history-run="${escapeHtml(run.id)}" type="button" ${run.status === "running" ? "disabled" : ""}><span class="history-date"><strong>${escapeHtml(formatDate(run.completed_at))}</strong><small>${run.trigger_type === "scheduled" ? "Automática" : "Manual"}</small></span><span class="history-status ${run.status}">${run.status === "success" ? "Concluída" : run.status === "running" ? "Em andamento" : "Falhou"}</span><span>${Number(run.items_count) || 0} conteúdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span class="history-open"><strong>${Number(run.sources_count) || 0} fontes</strong><small>${run.status === "running" ? "Aguarde" : "Ver notícias →"}</small></span></button>`).join("") : '<div class="loading-row">Nenhuma ronda armazenada.</div>';
  } catch (error) {
    holder.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;
  }
}

async function showHistoryDetail(runId) {
  const holder = document.getElementById("historyList");
  const detail = document.getElementById("historyDetail");
  const back = document.getElementById("historyBack");
  holder.hidden = true;
  detail.hidden = false;
  back.hidden = false;
  detail.innerHTML = '<div class="loading-row">Carregando as notícias desta ronda…</div>';
  try {
    const response = await api(`/api/runs/${encodeURIComponent(runId)}/data?t=${Date.now()}`);
    const data = response?.data || {};
    const run = response?.run || {};
    const items = [...(data.items || [])].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    const sourceCounts = new Map();
    for (const item of items) {
      const source = item.collectorName || item.sourceName || "Fonte não informada";
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    const sourceChips = [...sourceCounts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `<span>${escapeHtml(name)} · ${count}</span>`).join("");
    const news = items.length ? items.map((item) => `<article class="history-news"><div class="history-news-meta"><span class="kind ${escapeHtml((item.platform || item.kind || "fonte").toLowerCase())}">${escapeHtml(item.platform || (item.kind === "social" ? "Rede" : "Portal"))}</span><strong>${escapeHtml(item.sourceName || item.collectorName || "Fonte não informada")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir para apuração ↗</a></article>`).join("") : '<div class="empty history-empty"><strong>Nenhuma notícia armazenada nesta ronda</strong><span>Consulte o estado das fontes ou selecione outra ronda.</span></div>';
    detail.innerHTML = `<section class="history-detail-head"><p class="eyebrow">Notícias apuradas neste período</p><h3>${escapeHtml(formatDate(run.completedAt || data.collectedAt))}</h3><p>${run.triggerType === "scheduled" ? "Ronda automática" : "Ronda manual"} · ${items.length} conteúdos · ${Number(data.totals?.topics) || 0} assuntos</p></section>${sourceChips ? `<div class="history-source-chips">${sourceChips}</div>` : ""}<div class="history-news-list">${news}</div>`;
  } catch (error) {
    detail.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;
  }
}

function topicVerificationLinks(topic) {
  const storedLinks = Array.isArray(topic?.carousel?.verificationLinks) ? topic.carousel.verificationLinks : [];
  const candidates = storedLinks.length ? storedLinks : (topic?.items || []);
  const links = [];
  const seen = new Set();
  for (const item of candidates) {
    const url = safeUrl(item?.url);
    if (url === "#" || seen.has(url)) continue;
    seen.add(url);
    links.push({
      title: item?.title || "Notícia sem título",
      sourceName: item?.sourceName || item?.collectorName || "Fonte não informada",
      publishedAt: item?.publishedAt || null,
      url,
    });
  }
  return links;
}

function carouselAsText(topic) {
  const carousel = topic.carousel || {};
  const slides = Array.isArray(carousel.slides) ? carousel.slides : [];
  const verificationLinks = topicVerificationLinks(topic);
  return [
    `ROTEIRO DE CARROSSEL — ${topic.editoria || "Notícias"}`,
    `Tom de voz: ${carousel.voiceTone || "Informativo e objetivo"}`,
    `Modelo: ${carousel.postModel || "Resumo factual em 5 cards"}`,
    "",
    ...slides.flatMap((slide) => [
      `CARD ${slide.number} — ${String(slide.role || "").toUpperCase()}`,
      slide.title || "",
      slide.body || "",
      "",
    ]),
    "LINKS PARA APURAÇÃO",
    ...verificationLinks.flatMap((link, index) => [
      `${index + 1}. ${link.title}`,
      `Portal: ${link.sourceName}`,
      `URL: ${link.url}`,
      "",
    ]),
    carousel.disclaimer || "Revise e confirme as informações antes de publicar.",
  ].join("\n").trim();
}

function showCarousel(topicId) {
  const topic = (state.data?.topics || []).find((item) => item.id === topicId);
  if (!topic?.carousel?.slides?.length) {
    setStatus("warn", "Roteiro indisponível", "Execute uma nova ronda para gerar o modelo de carrossel.");
    return;
  }
  const carousel = topic.carousel;
  document.getElementById("carouselTitle").textContent = topic.title;
  document.getElementById("carouselMeta").innerHTML = `<span><small>Editoria</small><strong>${escapeHtml(topic.editoria || "Notícias")}</strong></span><span><small>Idioma</small><strong>Português</strong></span><span><small>Tom de voz</small><strong>${escapeHtml(carousel.voiceTone)}</strong></span><span><small>Modelo de post</small><strong>${escapeHtml(carousel.postModel)}</strong></span>`;
  document.getElementById("carouselSlides").innerHTML = carousel.slides.map((slide) => `<article class="carousel-slide"><div><span>${Number(slide.number) || ""}</span><small>${escapeHtml(slide.role)}</small></div><h3>${escapeHtml(slide.title)}</h3><p>${escapeHtml(slide.body).replace(/\n/g, "<br>")}</p></article>`).join("");
  const verificationLinks = topicVerificationLinks(topic);
  document.getElementById("carouselSources").innerHTML = `<div class="carousel-sources-head"><div><p class="eyebrow">Apuração obrigatória</p><h3>Links das notícias usadas</h3></div><span>${verificationLinks.length} ${verificationLinks.length === 1 ? "notícia" : "notícias"}</span></div><div class="carousel-source-list">${verificationLinks.map((link) => `<a class="carousel-source-link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}${link.publishedAt ? ` · ${escapeHtml(formatDate(link.publishedAt))}` : ""}</small></span><em>Abrir para apuração ↗</em></a>`).join("")}</div>`;
  document.getElementById("carouselDisclaimer").textContent = carousel.disclaimer || "Revise e confirme as informações antes de publicar.";
  document.getElementById("copyCarouselMessage").textContent = "";
  state.carouselText = carouselAsText(topic);
  openModal("carouselModal");
}

async function copyCarouselText() {
  const message = document.getElementById("copyCarouselMessage");
  try {
    await navigator.clipboard.writeText(state.carouselText);
    message.textContent = "Roteiro copiado.";
  } catch {
    const area = document.createElement("textarea");
    area.value = state.carouselText;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    message.textContent = copied ? "Roteiro copiado." : "Não foi possível copiar automaticamente.";
  }
}

async function startApplication() {
  render();
  document.getElementById("operationToken").value = operationToken();
  const healthy = await checkHealth();
  if (!healthy) return;
  const latest = await loadLatest();
  if (!latest && (!state.health.manualAuthRequired || operationToken())) executeRound(true);
}

runButton.addEventListener("click", () => executeRound(false));
document.getElementById("searchInput").addEventListener("input", (event) => { state.query = event.target.value; render(); });
document.getElementById("periodFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.period = Number(event.target.dataset.value);
  event.currentTarget.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === event.target));
  render();
});
document.getElementById("sourceFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.portal = null;
  setSourceSegment(event.target.dataset.value);
  state.expanded.clear();
  renderSourceHealth();
  render();
});
document.getElementById("regionFilter").addEventListener("click", (event) => {
  if (!event.target.matches("button")) return;
  state.portal = null;
  setRegionSegment(event.target.dataset.value);
  state.expanded.clear();
  renderSourceHealth();
  render();
});
document.getElementById("editoriaFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-editoria]");
  if (!button) return;
  state.editoria = button.dataset.editoria;
  event.currentTarget.querySelectorAll("[data-editoria]").forEach((item) => item.classList.toggle("active", item === button));
  state.expanded.clear();
  render();
});
document.getElementById("topicsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-carousel-topic]");
  if (button) showCarousel(button.dataset.carouselTopic);
});
document.getElementById("copyCarousel").addEventListener("click", copyCarouselText);
document.getElementById("settingsButton").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("openSettings").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("navHistory").addEventListener("click", showHistory);
document.getElementById("historyList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-history-run]");
  if (row && !row.disabled) showHistoryDetail(row.dataset.historyRun);
});
document.getElementById("historyBack").addEventListener("click", () => {
  document.getElementById("historyDetail").hidden = true;
  document.getElementById("historyList").hidden = false;
  document.getElementById("historyBack").hidden = true;
});
document.getElementById("navSources").addEventListener("click", () => { showView("sources"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navRound").addEventListener("click", () => { showView("round"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("goTop").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));
document.getElementById("showAllSources").addEventListener("click", () => filterByPortal(null));
document.getElementById("clearPortalFilter").addEventListener("click", () => filterByPortal(null));
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-portal]");
  if (!button) return;
  filterByPortal(button.dataset.portal);
});
document.getElementById("saveSettings").addEventListener("click", () => {
  const token = document.getElementById("operationToken").value.trim();
  try { token ? localStorage.setItem(STORAGE_TOKEN, token) : localStorage.removeItem(STORAGE_TOKEN); } catch {}
  document.getElementById("tokenMessage").textContent = "";
  closeModal("settingsModal");
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop:not([hidden])").forEach((modal) => closeModal(modal.id)); });

setInterval(async () => {
  if (state.running || !state.health) return;
  await checkHealth();
  await loadLatest({ quiet: true });
}, 30_000);

startApplication();
