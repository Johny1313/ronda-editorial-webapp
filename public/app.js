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
  activeCarousel: null,
  smartCarousels: new Map(),
  activeTopicId: null,
  carouselLoading: false,
  carouselRequestSerial: 0,
  customSources: [],
  customSourcesLimit: 8,
  monitoringTerms: [],
  monitoringTermsLimit: 6,
  monitoringTermFilter: "all",
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
const customSourcesView = document.getElementById("customSourcesView");
const monitoringView = document.getElementById("monitoringView");

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
    const parts = [payload?.error, payload?.detail].filter((value, index, list) => value && list.indexOf(value) === index);
    const error = new Error(parts.join(" — ") || `Falha HTTP ${response.status}`);
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
  return `<div class="${primary ? "primary-source" : "source"}"><div><div class="kicker"><span class="kind ${escapeHtml(platform.toLowerCase())}">${escapeHtml(platform)}</span><button class="source-name-button" data-portal="${escapeHtml(item.collectorName || item.sourceName)}" type="button" title="Mostrar somente esta fonte">${escapeHtml(item.sourceName)}</button><span>${escapeHtml(formatDate(item.publishedAt))}</span></div><h3>${escapeHtml(item.title)}</h3><div class="source-footer"><a class="open" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir para apuração ↗</a></div></div></div>`;
}

function sourceInitials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function sourceRegion(source) {
  return source?.region || (source?.name === "Bluesky" ? "Rede" : "Brasil");
}

function sourceRouteLabel(source, compact = false) {
  if (source?.cached || source?.route === "cache") return compact ? "cache" : "cache recente";
  if (source?.fallback || source?.route === "fallback") return compact ? "fb" : "fallback";
  if (source?.ok && Number(source?.count) > 0) return compact ? "dir" : "coleta direta";
  return "";
}

function portalCardMarkup(source) {
  const available = source.ok && Number(source.count) > 0;
  const portalAttribute = available ? `data-portal="${escapeHtml(source.name)}"` : "disabled";
  const route = sourceRouteLabel(source);
  const detail = available
    ? `${Number(source.count)} ${Number(source.count) === 1 ? "conteúdo recolhido" : "conteúdos recolhidos"}${route ? ` · ${route}` : ""}`
    : source.ok ? "Nenhuma notícia recente" : "Fonte indisponível nesta ronda";
  const stateClass = source.ok ? `ok${source.cached ? " cache" : ""}` : "error";
  return `<button class="portal-card ${stateClass}${state.portal === source.name ? " selected" : ""}" ${portalAttribute} type="button"><span class="portal-icon">${escapeHtml(sourceInitials(source.name))}</span><span class="portal-card-copy"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(detail)}</small></span><span class="portal-state">${available ? "Ver notícias →" : "Sem coleta"}</span></button>`;
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
      const route = sourceRouteLabel(source);
      const title = source.error || (available ? `Mostrar somente os ${source.count} conteúdos recolhidos de ${source.name}${route ? ` por ${route}` : ""}${source.warning ? `. Aviso: ${source.warning}` : ""}` : `Nenhum conteúdo recente de ${source.name}`);
      const status = available ? `${source.count}${sourceRouteLabel(source, true) ? ` ${sourceRouteLabel(source, true)}` : ""}` : source.ok ? "0" : "falhou";
      const stateClass = source.ok ? `ok${source.cached ? " cache" : ""}` : "error";
      return `<button class="health-chip ${stateClass}${state.portal === source.name ? " selected" : ""}" ${portalAttribute} type="button" aria-pressed="${state.portal === source.name}" title="${escapeHtml(title)}"><span class="health-icon">${escapeHtml(sourceInitials(source.name))}</span>${escapeHtml(source.name)} · ${escapeHtml(status)}</button>`;
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
  customSourcesView.hidden = view !== "custom-sources";
  monitoringView.hidden = view !== "monitoring";
  document.getElementById("navRound").classList.toggle("active", view === "round");
  document.getElementById("navSources").classList.toggle("active", view === "sources");
  document.getElementById("navCustomSources").classList.toggle("active", view === "custom-sources");
  document.getElementById("navMonitoring").classList.toggle("active", view === "monitoring");
  if (view === "sources") renderPortalCards();
  if (view === "custom-sources") loadCustomSources();
  if (view === "monitoring") {
    loadMonitoringTerms();
    renderDedicatedMonitoring();
  }
}

function operationHeaders() {
  const token = operationToken();
  return { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) };
}

function handleConfigurationError(error, messageId) {
  document.getElementById(messageId).textContent = error.message;
  if (error.status === 401) {
    document.getElementById("tokenMessage").textContent = "Informe a chave do Worker para alterar sites e termos.";
    openModal("settingsModal");
  }
}

function renderCustomSources() {
  const holder = document.getElementById("customSourcesList");
  const active = state.customSources.filter((source) => source.active).length;
  document.getElementById("customSourcesLimit").textContent = `${active}/${state.customSourcesLimit} ativos`;
  if (!state.customSources.length) {
    holder.innerHTML = '<div class="empty config-empty"><strong>Nenhum site cadastrado</strong><span>Cadastre um endereço para incluí-lo nas próximas rondas automáticas.</span></div>';
    return;
  }
  holder.innerHTML = state.customSources.map((source) => `<article class="config-row ${source.active ? "" : "inactive"}"><div class="config-status">${source.active ? "Ativo" : "Pausado"}</div><div class="config-main"><strong>${escapeHtml(source.name)}</strong><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a><small>${escapeHtml(source.region)} · ${source.active ? "entra nas próximas rondas" : "fora da coleta"}</small></div><div class="config-actions"><button class="secondary" data-custom-toggle="${escapeHtml(source.id)}" data-next-active="${source.active ? "false" : "true"}" type="button">${source.active ? "Pausar" : "Ativar"}</button><button class="danger-button" data-custom-delete="${escapeHtml(source.id)}" type="button">Remover</button></div></article>`).join("");
}

async function loadCustomSources() {
  try {
    const response = await api(`/api/custom-sources?t=${Date.now()}`);
    state.customSources = Array.isArray(response?.sources) ? response.sources : [];
    state.customSourcesLimit = Number(response?.limits?.maximumActive) || 8;
    renderCustomSources();
  } catch (error) {
    document.getElementById("customSourcesList").innerHTML = `<div class="empty config-empty"><strong>Não foi possível carregar os sites</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function submitCustomSource(event) {
  event.preventDefault();
  const message = document.getElementById("customSourceMessage");
  message.textContent = "Salvando…";
  try {
    await api("/api/custom-sources", {
      method: "POST",
      headers: operationHeaders(),
      body: JSON.stringify({
        name: document.getElementById("customSourceName").value,
        url: document.getElementById("customSourceUrl").value,
        region: document.getElementById("customSourceRegion").value,
      }),
    });
    event.currentTarget.reset();
    message.textContent = "Site cadastrado. Ele será incluído na próxima ronda automática.";
    await loadCustomSources();
  } catch (error) {
    handleConfigurationError(error, "customSourceMessage");
  }
}

async function changeCustomSource(id, options) {
  const message = document.getElementById("customSourceMessage");
  message.textContent = "Atualizando cadastro…";
  try {
    await api(`/api/custom-sources/${encodeURIComponent(id)}`, {
      method: options.delete ? "DELETE" : "PATCH",
      headers: operationHeaders(),
      ...(options.delete ? {} : { body: JSON.stringify({ active: options.active }) }),
    });
    message.textContent = options.delete ? "Site removido." : options.active ? "Site ativado para as próximas rondas." : "Site pausado.";
    await loadCustomSources();
  } catch (error) {
    handleConfigurationError(error, "customSourceMessage");
  }
}

function renderMonitoringTerms() {
  const holder = document.getElementById("monitoringTermsList");
  const activeTerms = state.monitoringTerms.filter((term) => term.active);
  document.getElementById("monitoringTermsLimit").textContent = `${activeTerms.length}/${state.monitoringTermsLimit} ativos`;
  if (!state.monitoringTerms.length) {
    holder.innerHTML = '<div class="empty config-empty"><strong>Nenhum termo cadastrado</strong><span>Exemplo: Vini Jr, inteligência artificial ou nome de uma empresa.</span></div>';
  } else {
    holder.innerHTML = state.monitoringTerms.map((term) => `<article class="config-row term-row ${term.active ? "" : "inactive"}"><div class="config-status">${term.active ? "Ativo" : "Pausado"}</div><div class="config-main"><strong>${escapeHtml(term.term)}</strong><small>${term.active ? "busca dedicada em todas as rondas" : "resultados ocultos e busca pausada"}</small></div><div class="config-actions"><button class="secondary" data-term-toggle="${escapeHtml(term.id)}" data-next-active="${term.active ? "false" : "true"}" type="button">${term.active ? "Pausar" : "Ativar"}</button><button class="danger-button" data-term-delete="${escapeHtml(term.id)}" type="button">Remover</button></div></article>`).join("");
  }
  if (!activeTerms.some((term) => term.id === state.monitoringTermFilter)) state.monitoringTermFilter = "all";
  renderDedicatedMonitoring();
}

async function loadMonitoringTerms() {
  try {
    const response = await api(`/api/monitoring-terms?t=${Date.now()}`);
    state.monitoringTerms = Array.isArray(response?.terms) ? response.terms : [];
    state.monitoringTermsLimit = Number(response?.limits?.maximumActive) || 6;
    renderMonitoringTerms();
  } catch (error) {
    document.getElementById("monitoringTermsList").innerHTML = `<div class="empty config-empty"><strong>Não foi possível carregar os termos</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function submitMonitoringTerm(event) {
  event.preventDefault();
  const message = document.getElementById("monitoringTermMessage");
  message.textContent = "Salvando…";
  try {
    await api("/api/monitoring-terms", {
      method: "POST",
      headers: operationHeaders(),
      body: JSON.stringify({ term: document.getElementById("monitoringTermInput").value }),
    });
    event.currentTarget.reset();
    message.textContent = "Termo adicionado. Os resultados chegarão na próxima ronda automática.";
    await loadMonitoringTerms();
  } catch (error) {
    handleConfigurationError(error, "monitoringTermMessage");
  }
}

async function changeMonitoringTerm(id, options) {
  const message = document.getElementById("monitoringTermMessage");
  message.textContent = "Atualizando termo…";
  try {
    await api(`/api/monitoring-terms/${encodeURIComponent(id)}`, {
      method: options.delete ? "DELETE" : "PATCH",
      headers: operationHeaders(),
      ...(options.delete ? {} : { body: JSON.stringify({ active: options.active }) }),
    });
    message.textContent = options.delete ? "Termo removido e resultados ocultados." : options.active ? "Termo reativado." : "Termo pausado e resultados ocultados.";
    await loadMonitoringTerms();
  } catch (error) {
    handleConfigurationError(error, "monitoringTermMessage");
  }
}

function renderDedicatedMonitoring() {
  const filterHolder = document.getElementById("monitoringTermFilters");
  const newsHolder = document.getElementById("dedicatedNewsList");
  const activeTerms = state.monitoringTerms.filter((term) => term.active);
  const allowedIds = new Set(activeTerms.map((term) => term.id));
  const monitoring = state.data?.dedicatedMonitoring || {};
  const allItems = (monitoring.items || []).filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => allowedIds.has(term.id)));
  const visible = state.monitoringTermFilter === "all"
    ? allItems
    : allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((term) => term.id === state.monitoringTermFilter));
  filterHolder.innerHTML = activeTerms.length
    ? `<button class="${state.monitoringTermFilter === "all" ? "active" : ""}" data-monitoring-filter="all" type="button">Todos · ${allItems.length}</button>${activeTerms.map((term) => {
      const count = allItems.filter((item) => (item.matchedTerms || [{ id: item.monitoringTermId }]).some((match) => match.id === term.id)).length;
      return `<button class="${state.monitoringTermFilter === term.id ? "active" : ""}" data-monitoring-filter="${escapeHtml(term.id)}" type="button">${escapeHtml(term.term)} · ${count}</button>`;
    }).join("")}`
    : "";
  document.getElementById("dedicatedMonitoringMeta").textContent = state.data?.collectedAt
    ? `${visible.length} resultado${visible.length === 1 ? "" : "s"} · ${relativeTime(state.data.collectedAt)}`
    : "Aguardando a primeira ronda";
  if (!activeTerms.length) {
    newsHolder.innerHTML = '<div class="empty"><strong>Nenhum termo ativo</strong><span>Adicione ou reative um termo para iniciar a busca dedicada.</span></div>';
    return;
  }
  if (!visible.length) {
    newsHolder.innerHTML = '<div class="empty"><strong>Nenhuma notícia encontrada na última ronda</strong><span>O termo continuará sendo procurado automaticamente a cada cinco minutos.</span></div>';
    return;
  }
  newsHolder.innerHTML = visible.map((item) => {
    const tags = (item.matchedTerms || [{ id: item.monitoringTermId, term: item.monitoringTerm }])
      .filter((term) => allowedIds.has(term.id))
      .map((term) => `<span>${escapeHtml(term.term)}</span>`)
      .join("");
    return `<article class="dedicated-news"><div class="dedicated-news-meta"><strong>${escapeHtml(item.sourceName || item.collectorName || "Fonte não informada")}</strong><time>${escapeHtml(formatDate(item.publishedAt))}</time></div><div class="dedicated-tags">${tags}</div><h3>${escapeHtml(item.title)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}<a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noreferrer">Abrir notícia ↗</a></article>`;
  }).join("");
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
    const latest = items[0].publishedAt;
    const open = state.expanded.has(topic.id);
    const editoria = topic.editoria || "Notícias";
    const carousel = topic.carousel || {};
    return `<article class="card ${escapeHtml(topic.tone)}"><div class="accent"></div><div class="card-body"><div class="topline"><div class="topic-labels"><span class="priority"><i></i>${escapeHtml(topic.priority)}</span><span class="editoria-badge">${escapeHtml(editoria)}</span></div><span class="score">Índice ${Number(topic.score) || 0}</span></div><h2>${escapeHtml(topic.title)}</h2><div class="card-sources"><span>Fontes</span>${sources.slice(0, 6).map((source) => `<button class="source-badge" data-portal="${escapeHtml(source)}" type="button" title="Filtrar por ${escapeHtml(source)}">${escapeHtml(source)}</button>`).join("")}${sources.length > 6 ? `<span class="source-badge">+${sources.length - 6}</span>` : ""}</div><div class="published"><span>Última postagem</span><strong>${escapeHtml(formatDate(latest))}</strong><span class="relative">${escapeHtml(relativeTime(latest))}</span></div><div class="momentum"><span class="trend">↗</span><span>${escapeHtml(topic.momentum)}</span><span class="calculated">calculado nesta ronda</span></div><div class="recommendation"><strong>Recomendação editorial:</strong> ${escapeHtml(topic.recommendation || "Confirmar as informações nas fontes originais antes de publicar.")}</div><div class="carousel-teaser"><div><span>Leitura inteligente</span><strong>Leitura de 1 matéria selecionada com fallback da mesma fonte</strong></div><div><span>Formato</span><strong>${escapeHtml(carousel.postModel || "Instagram · 7 slides")}</strong></div><button data-carousel-topic="${escapeHtml(topic.id)}" type="button">Gerar roteiro de carrossel →</button></div>${sourceMarkup(primary, true)}${additional.length ? `<button class="toggle" data-toggle="${escapeHtml(topic.id)}" aria-expanded="${open}" type="button"><span>${open ? "Ocultar outros conteúdos" : `Ver mais ${additional.length} ${additional.length === 1 ? "conteúdo" : "conteúdos"}`}</span><span>${open ? "⌃" : "⌄"}</span></button>` : ""}${open ? `<div class="source-list">${additional.map((item) => sourceMarkup(item)).join("")}</div>` : ""}</div></article>`;
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
  renderDedicatedMonitoring();
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
  if (id === "carouselModal") state.carouselRequestSerial += 1;
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
    const automationMessage = !translationReady
      ? "Automação ativa; tradução internacional indisponível no Cloudflare."
      : health.schedulerHealthy
      ? "Automação online ativa e atualizada."
      : health.lastSuccessAt
        ? "Automação online configurada; a última ronda está atrasada."
        : "Serviço online pronto; aguardando a primeira ronda.";
    document.getElementById("automationText").textContent = `${automationMessage} A coleta continua com a janela fechada.`;
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

function entityLine(label, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return `${label}: ${list.length ? list.join(", ") : "Não identificado"}`;
}

function carouselAsText(topic, carousel) {
  const slides = Array.isArray(carousel?.slides) ? carousel.slides : [];
  const verificationLinks = Array.isArray(carousel?.verificationLinks) && carousel.verificationLinks.length
    ? carousel.verificationLinks
    : topicVerificationLinks(topic);
  const questions = carousel?.questions || {};
  const entities = carousel?.entities || {};
  const reading = carousel?.reading || {};
  const facts = Array.isArray(carousel?.facts) ? carousel.facts : [];
  return [
    `ROTEIRO DE CARROSSEL — ${topic.editoria || "Notícias"}`,
    "LEITURA INTELIGENTE — UMA MATÉRIA POR SUGESTÃO",
    `Modo: ${carousel?.analysisMode === "ai" ? "Workers AI" : "Análise automática de contingência"}`,
    `Qualidade: ${reading.qualityLabel || "Conteúdo disponível"}`,
    `Fonte selecionada: ${reading.selectedSource?.sourceName || reading.sources?.[0]?.sourceName || "Não informada"}`,
    `Leitura direta: ${Number(reading.liveSuccessful) ? "sim" : "não"}`,
    `Fallback da mesma matéria: ${Number(reading.fallbackSources) ? "sim" : "não"}`,
    `Ciclo encerrado: ${reading.cycleComplete ? "sim" : "não"}`,
    `Sistema liberado para novo ciclo: ${carousel?.cycle?.nextCycleAllowed || reading.nextCycleAllowed ? "sim" : "não"}`,
    `Palavras analisadas: ${Number(reading.totalWords) || 0}`,
    `Tom de voz: ${carousel?.voiceTone || "Jornalístico, factual e explicativo"}`,
    `Formato: ${carousel?.postModel || "Instagram · 7 slides"}`,
    "",
    "INTERPRETAÇÃO DA NOTÍCIA",
    `O que aconteceu: ${questions.whatHappened || "Não informado"}`,
    `Quem está envolvido: ${questions.who || "Não informado"}`,
    `Onde aconteceu: ${questions.where || "Não informado"}`,
    `Quando aconteceu: ${questions.when || "Não informado"}`,
    `Qual o impacto: ${questions.impact || "Não informado"}`,
    `Qual a repercussão: ${questions.repercussion || "Não informado"}`,
    "",
    "DADOS ESTRUTURADOS",
    entityLine("Personagens", entities.people),
    entityLine("Empresas", entities.companies),
    entityLine("Locais", entities.places),
    entityLine("Datas", entities.dates),
    entityLine("Temas", entities.themes),
    entityLine("Palavras-chave", entities.keywords),
    "",
    "MAPA DE FATOS E EVIDÊNCIAS",
    ...facts.flatMap((fact, index) => [
      `${index + 1}. ${fact.claim || ""}`,
      `Evidência: ${fact.evidence || "Não informada"}`,
      `Confiança: ${fact.confidence || "não informada"}`,
      "",
    ]),
    ...slides.flatMap((slide) => [
      `SLIDE ${slide.number} — ${String(slide.role || "").toUpperCase()}`,
      slide.title || "",
      slide.subtitle || slide.body || "",
      "",
    ]),
    "LINKS PARA APURAÇÃO",
    ...verificationLinks.flatMap((link, index) => [
      `${index + 1}. ${link.title}`,
      `Portal: ${link.sourceName}`,
      `URL: ${link.url}`,
      "",
    ]),
    carousel?.disclaimer || "Revise e confirme as informações antes de publicar.",
  ].join("\n").trim();
}

function carouselCacheKey(topicId) {
  return `${state.data?.runId || state.lastRunId || "latest"}:${topicId}`;
}

function setCarouselLoading(loading, message = "", options = {}) {
  state.carouselLoading = loading;
  const holder = document.getElementById("carouselLoading");
  holder.hidden = false;
  holder.classList.toggle("error", !loading && Boolean(message));
  const progress = Math.max(0, Math.min(100, Number(options.progress) || 0));
  const title = options.title || (loading ? "Leitura inteligente em andamento" : "Roteiro não concluído");
  if (loading) {
    holder.innerHTML = `<span class="reader-spinner">↻</span><div class="reader-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message || "Abrindo uma matéria e preparando o roteiro.")}</small><div class="reader-progress"><i style="width:${progress}%"></i></div><em>${progress}%</em></div>`;
  } else {
    const retry = options.retry ? '<button class="reader-retry" data-retry-carousel type="button">Tentar novamente</button>' : "";
    holder.innerHTML = `<span class="reader-error">!</span><div class="reader-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>${retry}</div>`;
  }
  document.getElementById("copyCarousel").disabled = loading || Boolean(message);
}

function setCarouselJobProgress(job = {}) {
  const statusTitle = job.status === "queued" ? "Leitura adicionada à fila" : "Leitura inteligente em andamento";
  setCarouselLoading(true, job.message || "Processando a matéria selecionada.", {
    progress: Number(job.progress) || 1,
    title: statusTitle,
  });
}

async function waitForIntelligentJob(jobId, requestSerial, pollAfterMs = 1_200) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (requestSerial !== state.carouselRequestSerial) return null;
    await wait(Math.max(700, Number(pollAfterMs) || 1_200));
    if (requestSerial !== state.carouselRequestSerial) return null;
    const response = await api(`/api/intelligent-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);
    const job = response?.job || {};
    if (job.status === "succeeded" && response?.data?.slides?.length) return response.data;
    if (job.status === "failed") {
      const detail = job.error || job.message || "O processamento foi interrompido.";
      throw new Error(`${detail} O ciclo foi encerrado e o sistema está liberado para tentar uma nova leitura.`);
    }
    setCarouselJobProgress(job);
  }
  throw new Error("A leitura ultrapassou três minutos. O processamento pode continuar na fila; feche e abra novamente este assunto para consultar o resultado.");
}

function questionCard(label, value) {
  return `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value || "Não informado no conteúdo coletado.")}</p></article>`;
}

function entityGroup(label, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return `<div><small>${escapeHtml(label)}</small><div class="entity-chips">${list.length ? list.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : '<em>Não identificado</em>'}</div></div>`;
}

function confidenceLabel(value) {
  if (value === "high") return "Alta";
  if (value === "medium") return "Média";
  return "Baixa";
}

function slideEditorMarkup(slide, index) {
  const title = String(slide.title || "");
  const subtitle = String(slide.subtitle || slide.body || "");
  return `<article class="carousel-slide" data-slide-index="${index}"><div><span>${Number(slide.number) || ""}</span><small>${escapeHtml(slide.role)}</small></div><h3 contenteditable="true" spellcheck="true" data-slide-title="${index}" aria-label="Editar título do slide ${index + 1}">${escapeHtml(title)}</h3><p contenteditable="true" spellcheck="true" data-slide-subtitle="${index}" aria-label="Editar subtítulo do slide ${index + 1}">${escapeHtml(subtitle).replace(/\n/g, "<br>")}</p><footer><span data-title-count>${title.length}/68</span><span data-subtitle-count>${subtitle.length}/190</span></footer></article>`;
}

function updateEditedSlide(target) {
  const holder = target.closest("[data-slide-index]");
  const index = Number(holder?.dataset.slideIndex);
  const topic = (state.data?.topics || []).find((item) => item.id === state.activeTopicId);
  const slide = state.activeCarousel?.slides?.[index];
  if (!holder || !slide || !topic) return;
  const title = holder.querySelector("[data-slide-title]")?.innerText.trim() || "";
  const subtitle = holder.querySelector("[data-slide-subtitle]")?.innerText.trim() || "";
  slide.title = title;
  slide.subtitle = subtitle;
  slide.body = subtitle;
  holder.querySelector("[data-title-count]").textContent = `${title.length}/68`;
  holder.querySelector("[data-subtitle-count]").textContent = `${subtitle.length}/190`;
  holder.classList.toggle("over-limit", title.length > 68 || subtitle.length > 190);
  state.carouselText = carouselAsText(topic, state.activeCarousel);
}

function renderIntelligentCarousel(topic, carousel) {
  document.getElementById("carouselLoading").hidden = true;
  document.getElementById("carouselTitle").textContent = topic.title;
  state.activeCarousel = {
    ...carousel,
    slides: (carousel.slides || []).map((slide) => ({ ...slide, evidenceIds: [...(slide.evidenceIds || [])] })),
  };
  const reading = carousel.reading || {};
  document.getElementById("carouselMeta").innerHTML = `<span><small>Editoria</small><strong>${escapeHtml(topic.editoria || "Notícias")}</strong></span><span><small>Idioma</small><strong>Português</strong></span><span><small>Tom de voz</small><strong>${escapeHtml(carousel.voiceTone || "Jornalístico e factual")}</strong></span><span><small>Formato</small><strong>${escapeHtml(carousel.postModel || "Instagram · 7 slides")}</strong></span><span><small>Análise</small><strong>${carousel.analysisMode === "ai" ? "Workers AI" : "Contingência automática"}</strong></span>`;
  const readingHolder = document.getElementById("carouselReading");
  readingHolder.hidden = false;
  const selectedSource = reading.selectedSource || (reading.sources || [])[0] || {};
  const modeLabel = selectedSource.readMode === "full-article-cache" ? "Texto em cache" : Number(reading.liveSuccessful) ? "Texto da matéria" : "Fallback do feed";
  const selection = selectedSource.selection || {};
  const cycleReleased = Boolean(carousel.cycle?.released && carousel.cycle?.nextCycleAllowed && reading.cycleComplete);
  readingHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Leitura de uma matéria</p><h3>Uma fonte por sugestão, com encerramento automático</h3></div><span>${cycleReleased ? "Ciclo liberado" : `${Number(reading.successful) || 0}/1 matéria`}</span></div><div class="reading-stats"><span><small>Fonte selecionada</small><strong>${escapeHtml(selectedSource.sourceName || "Não informada")}</strong></span><span><small>Modo de leitura</small><strong>${escapeHtml(modeLabel)}</strong></span><span><small>Palavras analisadas</small><strong>${Number(reading.totalWords) || 0}</strong></span><span><small>Seleção</small><strong>${selection.score ? `${Number(selection.score)} pontos · ${Number(selection.candidatesEvaluated) || 1} avaliadas` : "Melhor fonte disponível"}</strong></span><span class="cycle-release"><small>Ciclo</small><strong>${cycleReleased ? "Encerrado · próximo ciclo liberado" : "Finalização pendente"}</strong></span></div>`;

  const evidenceHolder = document.getElementById("carouselEvidence");
  const facts = Array.isArray(carousel.facts) ? carousel.facts : [];
  evidenceHolder.hidden = false;
  evidenceHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Rastreabilidade factual</p><h3>Mapa de fatos e evidências</h3></div><span>${facts.length} ${facts.length === 1 ? "fato validado" : "fatos validados"}</span></div><div class="evidence-list">${facts.length ? facts.map((fact) => `<article id="evidence-${escapeHtml(fact.id)}"><div><strong>${escapeHtml(fact.claim)}</strong><small>Confiança ${escapeHtml(confidenceLabel(fact.confidence))}</small></div><p>${escapeHtml(fact.evidence)}</p></article>`).join("") : "<p>Nenhuma evidência estruturada foi retornada.</p>"}</div>`;

  const questions = carousel.questions || {};
  const analysisHolder = document.getElementById("carouselAnalysis");
  analysisHolder.hidden = false;
  analysisHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Interpretação da notícia</p><h3>Respostas editoriais</h3></div></div><div class="question-grid">${questionCard("O que aconteceu?", questions.whatHappened)}${questionCard("Quem está envolvido?", questions.who)}${questionCard("Onde aconteceu?", questions.where)}${questionCard("Quando aconteceu?", questions.when)}${questionCard("Qual o impacto?", questions.impact)}${questionCard("Qual a repercussão?", questions.repercussion)}</div>`;

  const entities = carousel.entities || {};
  const entityHolder = document.getElementById("carouselEntities");
  entityHolder.hidden = false;
  entityHolder.innerHTML = `<div class="carousel-section-head"><div><p class="eyebrow">Estrutura de dados</p><h3>Elementos extraídos</h3></div></div><div class="entity-grid">${entityGroup("Personagens", entities.people)}${entityGroup("Empresas", entities.companies)}${entityGroup("Locais", entities.places)}${entityGroup("Datas", entities.dates)}${entityGroup("Temas", entities.themes)}${entityGroup("Palavras-chave", entities.keywords)}</div>`;

  document.getElementById("carouselSlides").innerHTML = (state.activeCarousel.slides || []).map(slideEditorMarkup).join("");
  const verificationLinks = Array.isArray(carousel.verificationLinks) ? carousel.verificationLinks : topicVerificationLinks(topic);
  const readingSources = new Map();
  for (const item of reading.sources || []) {
    const urls = [item?.url, item?.originalUrl, item?.extractionUrl]
      .filter((url) => /^https?:\/\//i.test(String(url || "")))
      .map(safeUrl);
    urls.forEach((url) => readingSources.set(url, item));
  }
  document.getElementById("carouselSources").innerHTML = `<div class="carousel-sources-head"><div><p class="eyebrow">Apuração obrigatória</p><h3>Matéria utilizada e links adicionais</h3></div><span>${verificationLinks.length} ${verificationLinks.length === 1 ? "notícia" : "notícias"}</span></div><div class="carousel-source-list">${verificationLinks.map((link) => {
    const source = readingSources.get(safeUrl(link.url));
    const direct = /^full-article/.test(source?.readMode || "");
    const level = direct ? "Matéria lida" : source?.contentLevel === "content" ? "Fallback · texto do feed" : source?.contentLevel === "summary" ? "Fallback · resumo do feed" : source ? "Fallback · somente título" : "Link adicional";
    const status = source ? `${level} · ${Number(source.wordCount) || 0} palavras${source.liveReadError ? ` · ${source.liveReadError}` : ""}` : "Link adicional para apuração";
    const sourceClass = direct ? "read-ok" : source ? "read-fallback" : "";
    return `<a class="carousel-source-link ${sourceClass}" href="${escapeHtml(safeUrl(link.url))}" target="_blank" rel="noreferrer"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}${link.publishedAt ? ` · ${escapeHtml(formatDate(link.publishedAt))}` : ""}</small><small class="read-status">${escapeHtml(status)}</small></span><em>Abrir para apuração ↗</em></a>`;
  }).join("")}</div>`;
  document.getElementById("carouselDisclaimer").textContent = carousel.disclaimer || "Revise e confirme as informações antes de publicar.";
  const gate = carousel.editorialGate || {};
  const validation = carousel.validation || {};
  const messages = [];
  if (cycleReleased) messages.push("Ciclo encerrado e sistema liberado para uma nova leitura.");
  if (carousel.aiError) messages.push(`A IA falhou e foi usado o modo de contingência: ${carousel.aiError}`);
  if (!gate.copyAllowed) messages.push(gate.reason || "A cópia foi bloqueada até a revisão editorial.");
  if (validation.correctedSlides?.length) messages.push(`Validador corrigiu os slides: ${validation.correctedSlides.join(", ")}.`);
  document.getElementById("copyCarouselMessage").textContent = messages.join(" ");
  state.carouselText = carouselAsText(topic, state.activeCarousel);
  document.getElementById("copyCarousel").disabled = !gate.copyAllowed || !cycleReleased;
}

async function showCarousel(topicId, { force = false } = {}) {
  const topic = (state.data?.topics || []).find((item) => item.id === topicId);
  if (!topic) {
    setStatus("warn", "Assunto indisponível", "Atualize a ronda e tente novamente.");
    return;
  }
  const requestSerial = state.carouselRequestSerial + 1;
  state.carouselRequestSerial = requestSerial;
  state.activeTopicId = topicId;
  document.getElementById("carouselTitle").textContent = topic.title;
  document.getElementById("carouselMeta").innerHTML = "";
  document.getElementById("carouselReading").hidden = true;
  document.getElementById("carouselEvidence").hidden = true;
  document.getElementById("carouselAnalysis").hidden = true;
  document.getElementById("carouselEntities").hidden = true;
  document.getElementById("carouselSlides").innerHTML = "";
  document.getElementById("carouselSources").innerHTML = "";
  document.getElementById("carouselDisclaimer").textContent = "";
  document.getElementById("copyCarouselMessage").textContent = "";
  state.carouselText = "";
  state.activeCarousel = null;
  openModal("carouselModal");

  const key = carouselCacheKey(topicId);
  const cached = !force ? state.smartCarousels.get(key) : null;
  if (cached) {
    renderIntelligentCarousel(topic, cached);
    return;
  }
  setCarouselLoading(true, "Selecionando uma única matéria e preparando o roteiro.", { progress: 1 });
  const token = operationToken();
  try {
    const response = await api(`/api/topics/${encodeURIComponent(topicId)}/intelligent-carousel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Round-Token": token } : {}) },
      body: JSON.stringify({ runId: state.data?.runId || state.lastRunId || null, force }),
    });
    if (requestSerial !== state.carouselRequestSerial) return;
    let data = response?.data;
    if (!data?.slides?.length && response?.job?.jobId) {
      setCarouselJobProgress(response.job);
      data = await waitForIntelligentJob(response.job.jobId, requestSerial, response.pollAfterMs);
    }
    if (requestSerial !== state.carouselRequestSerial || !data) return;
    if (!data.slides?.length) throw new Error("O servidor não retornou os sete slides esperados.");
    state.smartCarousels.set(key, data);
    renderIntelligentCarousel(topic, data);
  } catch (error) {
    if (requestSerial !== state.carouselRequestSerial) return;
    if (error.status === 401) {
      document.getElementById("tokenMessage").textContent = "Informe a chave do Worker para usar a leitura inteligente.";
    }
    setCarouselLoading(false, error.message, { retry: true });
    document.getElementById("carouselSources").innerHTML = `<div class="carousel-sources-head"><div><p class="eyebrow">Apuração manual</p><h3>Abra as notícias originais</h3></div></div><div class="carousel-source-list">${topicVerificationLinks(topic).map((link) => `<a class="carousel-source-link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer"><span><strong>${escapeHtml(link.title)}</strong><small>${escapeHtml(link.sourceName)}</small></span><em>Abrir para apuração ↗</em></a>`).join("")}</div>`;
  }
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
document.getElementById("carouselSlides").addEventListener("input", (event) => {
  if (event.target.matches("[data-slide-title], [data-slide-subtitle]")) updateEditedSlide(event.target);
});
document.getElementById("carouselLoading").addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry-carousel]");
  if (button && state.activeTopicId) showCarousel(state.activeTopicId, { force: true });
});
document.getElementById("customSourceForm").addEventListener("submit", submitCustomSource);
document.getElementById("customSourcesList").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-custom-toggle]");
  const remove = event.target.closest("[data-custom-delete]");
  if (toggle) changeCustomSource(toggle.dataset.customToggle, { active: toggle.dataset.nextActive === "true" });
  if (remove) changeCustomSource(remove.dataset.customDelete, { delete: true });
});
document.getElementById("monitoringTermForm").addEventListener("submit", submitMonitoringTerm);
document.getElementById("monitoringTermsList").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-term-toggle]");
  const remove = event.target.closest("[data-term-delete]");
  if (toggle) changeMonitoringTerm(toggle.dataset.termToggle, { active: toggle.dataset.nextActive === "true" });
  if (remove) changeMonitoringTerm(remove.dataset.termDelete, { delete: true });
});
document.getElementById("monitoringTermFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-monitoring-filter]");
  if (!button) return;
  state.monitoringTermFilter = button.dataset.monitoringFilter;
  renderDedicatedMonitoring();
});
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
document.getElementById("navCustomSources").addEventListener("click", () => { showView("custom-sources"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
document.getElementById("navMonitoring").addEventListener("click", () => { showView("monitoring"); document.getElementById("workspaceTop").scrollIntoView({ behavior: "smooth" }); });
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
