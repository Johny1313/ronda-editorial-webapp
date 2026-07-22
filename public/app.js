const STORAGE_TOKEN = "ronda-editorial-operation-token-v1";
const state = {
  data: null,
  health: null,
  query: "",
  period: 1440,
  source: "Todos",
  expanded: new Set(),
  running: false,
  lastRunId: null,
};

const numberFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const runButton = document.getElementById("runRound");
const grid = document.getElementById("topicsGrid");
const liveDot = document.getElementById("liveDot");
const statusLabel = document.getElementById("statusLabel");
const statusSub = document.getElementById("statusSub");

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
  return state.source === "Todos" || (state.source === "Portal" ? item.kind === "portal" : item.kind === "social");
}

function itemWithinPeriod(item) {
  const age = (Date.now() - Date.parse(item.publishedAt)) / 60_000;
  return Number.isFinite(age) && age >= -5 && age <= state.period;
}

function sourceMarkup(item, primary = false) {
  const platform = item.platform || (item.kind === "portal" ? "Portal" : "Rede");
  const metrics = [`<span>Views: <strong>${metricValue(item.views)}</strong></span>`];
  if (item.kind === "social") metrics.push(`<span>Comentários: <strong>${metricValue(item.comments)}</strong></span>`);
  return `<div class="${primary ? "primary" : "source"}"><div><div class="kicker"><span class="kind ${escapeHtml(platform.toLowerCase())}">${escapeHtml(platform)}</span><strong>${escapeHtml(item.sourceName)}</strong><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class="source-footer"><div class="source-metrics">${metrics.join("")}</div><a class="open" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">${item.kind === "portal" ? "Abrir para apuração" : "Ver post"} ↗</a></div></div></div>`;
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
  const okCount = sources.filter((source) => source.ok).length;
  holder.innerHTML = `<span class="health-label">Fontes ${okCount}/${sources.length}</span>${sources.map((source) => `<span class="health-chip ${source.ok ? "ok" : "error"}" title="${escapeHtml(source.error || `${source.count} conteúdos${source.fallback ? " por rota alternativa" : ""}`)}">${escapeHtml(source.name)} · ${source.ok ? `${source.count}${source.fallback ? " alt." : ""}` : "falhou"}</span>`).join("")}`;
}

function render() {
  const topics = state.data?.topics || [];
  const query = state.query.trim().toLocaleLowerCase("pt-BR");
  const visible = topics
    .map((topic) => ({ ...topic, items: (topic.items || []).filter((item) => itemWithinPeriod(item) && itemMatchesSource(item)) }))
    .filter((topic) => topic.items.length && (!query || `${topic.title} ${topic.items.map((item) => `${item.sourceName} ${item.title}`).join(" ")}`.toLocaleLowerCase("pt-BR").includes(query)));

  document.getElementById("summaryTopics").textContent = visible.length;
  document.getElementById("summaryContents").textContent = visible.reduce((sum, topic) => sum + topic.items.length, 0);
  document.getElementById("summaryChannels").textContent = new Set(visible.flatMap((topic) => topic.items.map((item) => item.sourceName))).size;
  document.getElementById("summaryUrgent").textContent = visible.filter((topic) => topic.tone === "urgent").length;

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
    return `<article class="card ${escapeHtml(topic.tone)}"><div class="accent"></div><div class="card-body"><div class="topline"><span class="priority"><i></i>${escapeHtml(topic.priority)}</span><span class="score">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class="card-sources"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<span class="source-badge">${escapeHtml(source)}</span>`).join("")}${sources.length > 6 ? `<span class="source-badge">+${sources.length - 6}</span>` : ""}</div><div class="published"><span>Última postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class="relative">${escapeHtml(relativeTime(latest))}</span></div><div class="metrics"><div class="metric"><span>Visualizações observadas</span><strong>${metricValue(views)}</strong></div><div class="metric"><span>Comentários</span><strong>${metricValue(comments)}</strong></div><div class="metric"><span>Fontes diferentes</span><strong>${sources.length}</strong></div><div class="metric"><span>Conteúdos</span><strong>${items.length}</strong></div></div><div class="momentum"><span class="trend">↗</span><span>${escapeHtml(topic.momentum)}</span><span class="calculated">calculado nesta ronda</span></div><div class="recommendation"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || "Confirmar as informações nas fontes originais antes de publicar.")}</div>${sourceMarkup(primary, true)}${additional.length ? `<button class="toggle" data-toggle="${escapeHtml(topic.id)}" aria-expanded="${open}" type="button"><span>${open ? "Ocultar outras fontes" : `Ver mais ${additional.length} ${additional.length === 1 ? "fonte" : "fontes"}`}</span><span>${open ? "⌃" : "⌄"}</span></button>` : ""}${open ? `<div class="source-list">${additional.map((item) => sourceMarkup(item)).join("")}</div>` : ""}</div></article>`;
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
    applyRound(payload.data);
    setStatus("ok", "Ronda concluída", `Coleta finalizada às ${new Date(payload.data.collectedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
  } catch (error) {
    if (error.status === 401) {
      document.getElementById("tokenMessage").textContent = "Chave incorreta. Confira a variável MANUAL_ROUND_TOKEN.";
      openModal("settingsModal");
    }
    const locked = error.status === 409 || error.status === 429;
    setStatus(locked ? "warn" : "error", locked ? "Ronda já em andamento" : "Falha ao executar a ronda", error.message);
    renderSourceHealth(error.message, locked);
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
    state.health = health;
    document.getElementById("automationText").textContent = health.schedulerHealthy
      ? "Automação online ativa e atualizada."
      : health.lastSuccessAt
        ? "Automação online configurada; a última ronda está atrasada."
        : "Serviço online pronto; aguardando a primeira ronda.";
    setStatus(health.schedulerHealthy ? "ok" : "warn", health.schedulerHealthy ? "Serviço online" : "Aguardando automação", health.lastSuccessAt ? `Última ronda ${relativeTime(health.lastSuccessAt)}` : "Execute a primeira ronda");
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
  holder.innerHTML = '<div class="loading-row">Carregando histórico…</div>';
  try {
    const payload = await api("/api/history?limit=50");
    const runs = payload?.runs || [];
    holder.innerHTML = runs.length ? runs.map((run) => `<div class="history-row"><div><strong>${escapeHtml(formatDate(run.completed_at))}</strong><br><span>${run.trigger_type === "scheduled" ? "Automática" : "Manual"}</span></div><span class="history-status ${run.status}">${run.status === "success" ? "Concluída" : "Falhou"}</span><span>${Number(run.items_count) || 0} conteúdos</span><span>${Number(run.topics_count) || 0} assuntos</span><span>${Number(run.sources_count) || 0} fontes</span></div>`).join("") : '<div class="loading-row">Nenhuma ronda armazenada.</div>';
  } catch (error) {
    holder.innerHTML = `<div class="loading-row">${escapeHtml(error.message)}</div>`;
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
  state.source = event.target.dataset.value;
  event.currentTarget.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === event.target));
  state.expanded.clear();
  render();
});
document.getElementById("settingsButton").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("openSettings").addEventListener("click", () => openModal("settingsModal"));
document.getElementById("navHistory").addEventListener("click", showHistory);
document.getElementById("navSources").addEventListener("click", () => document.getElementById("sourceHealth").scrollIntoView({ behavior: "smooth", block: "center" }));
document.getElementById("navRound").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));
document.getElementById("goTop").addEventListener("click", () => document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }));
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
