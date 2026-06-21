let API_BASE, map, markersLayer, boundaryLayer, boundaryCache, seenIds, allDistritos, currentFilters;
let deptMap = {};
let deptList = [];

const C = {
  blue: "#3a7bd5",
  purple: "#8a4fc9",
  amber: "#d18a3a",
  cyan: "#22b8c8",
  green: "#2ecc71",
  red: "#e74c3c",
  yellow: "#f1c40f",
};

const TILE_DARK = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const TILE_LIGHT = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap contributors",
};
let currentTileLayer = null;

function getSavedTheme() {
  try { return localStorage.getItem("georisk_map_theme") || "dark"; }
  catch { return "dark"; }
}

function saveTheme(theme) {
  try { localStorage.setItem("georisk_map_theme", theme); } catch {}
}

function applyTileTheme(theme) {
  const cfg = theme === "light" ? TILE_LIGHT : TILE_DARK;
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(cfg.url, { maxZoom: 19, attribution: cfg.attribution });
  currentTileLayer.addTo(map);
}

function initGlobals() {
  API_BASE = `${location.origin}/api`;
  map = L.map("map").setView([-12.08, -77.03], 6);
  applyTileTheme(getSavedTheme());
  markersLayer = L.layerGroup().addTo(map);
  boundaryLayer = null;
  boundaryCache = new Map();
  seenIds = new Set();
  allDistritos = [];
  deptMap = {};
  deptList = [];
  currentFilters = { distrito: null, gravedad: null, departamento: null, provincia: null };
}

function $(id) { return document.getElementById(id); }
window.$ = $;

/* ===== Pin icon ===== */

function pinSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.8 0 1 5.8 1 13c0 9.8 13 22 13 22s13-12.2 13-22C27 5.8 21.2 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="13" r="5" fill="#fff" opacity=".9"/>
  </svg>`;
}

function pinIcon(color) {
  return L.divIcon({
    html: pinSvg(color),
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
  });
}

/* ===== helpers ===== */

function gravedadColor(g) {
  if (g === "Alta") return C.red;
  if (g === "Media") return C.yellow;
  return C.green;
}

function normalizeAccident(acc) {
  return {
    ...acc,
    fecha: String(acc.fecha).slice(0, 10),
    ubigeo: acc.ubigeo != null ? String(acc.ubigeo).trim() : null,
  };
}

function makeMarker(acc) {
  const marker = L.marker([acc.lat, acc.lng], { icon: pinIcon(gravedadColor(acc.gravedad)) });

  marker.bindPopup(`
    <b>Accidente #${acc.id}</b><br/>
    <b>Fecha:</b> ${acc.fecha}<br/>
    <b>Hora:</b> ${acc.hora}<br/>
    <b>Distrito:</b> ${acc.distrito}<br/>
    <b>Provincia:</b> ${acc.provincia || acc.raw?.provincia || "-"}<br/>
    <b>Departamento:</b> ${acc.departamento || acc.raw?.departamento || "-"}<br/>
    <b>Tipo:</b> ${acc.tipo}<br/>
    <b>Gravedad:</b> ${acc.gravedad}<br/>
    <b>Vehículos:</b> ${acc.vehiculos ?? "?"}<br/>
    <button onclick="openAuditModal(${acc.id})" style="background:none;border:1px solid var(--border);color:#c79a5a;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;margin-top:4px;font-family:inherit;">Ver auditor&iacute;a</button>
  `);
  return marker;
}

function renderData(data) {
  markersLayer.clearLayers();
  seenIds.clear();
  if (!Array.isArray(data)) return;
  for (const a of data) {
    const acc = normalizeAccident(a);
    seenIds.add(acc.id);
    markersLayer.addLayer(makeMarker(acc));
  }
}

/* ===== KPIs ===== */

function computeKpis(accs) {
  const total = accs.length;
  const porGravedad = { Baja: 0, Media: 0, Alta: 0 };
  let suma = 0;
  for (const a of accs) {
    const g = a.gravedad;
    if (g === "Baja") { porGravedad.Baja++; suma += 1; }
    else if (g === "Media") { porGravedad.Media++; suma += 2; }
    else if (g === "Alta") { porGravedad.Alta++; suma += 3; }
  }
  const prom = total > 0 ? (suma / total).toFixed(1) : "0.0";
  return { total, porGravedad, gravedadPromedio: prom };
}

function renderKpis(kpis) {
  if (!kpis) return;
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val ?? 0; };
  set("kpiTotal", kpis.total);
  set("kpiBaja", kpis.porGravedad?.Baja);
  set("kpiMedia", kpis.porGravedad?.Media);
  set("kpiAlta", kpis.porGravedad?.Alta);
  set("kpiProm", kpis.gravedadPromedio);
}

function passesCurrentFilters(acc) {
  if (currentFilters.gravedad && acc.gravedad !== currentFilters.gravedad) return false;
  if (currentFilters.distrito === "SRATMA") return String(acc.distrito).trim() === "SRATMA";
  if (currentFilters.distrito && /^\d{6}$/.test(currentFilters.distrito)) {
    const ubigeo = acc.ubigeo ? String(acc.ubigeo).trim() : null;
    if (ubigeo !== currentFilters.distrito) return false;
  }
  if (currentFilters.departamento && !currentFilters.distrito) {
    const dep = acc.departamento || acc.raw?.departamento || "";
    if (dep !== currentFilters.departamento) return false;
  }
  if (currentFilters.provincia && !currentFilters.distrito) {
    const prov = acc.provincia || acc.raw?.provincia || "";
    if (prov !== currentFilters.provincia) return false;
  }
  return true;
}

function fitMapToVisibleMarkers() {
  const layers = markersLayer.getLayers();
  if (layers.length === 0) return;
  map.fitBounds(L.featureGroup(layers).getBounds().pad(0.2));
}

function clearBoundary() {
  if (boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
}

/* ===== Boundary drawing (department / province / district) ===== */

function boundaryStyle(level) {
  const shared = { dashArray: null };
  if (level === "departamento") return { ...shared, color: C.blue, weight: 4, fillColor: C.blue, fillOpacity: 0.04 };
  if (level === "provincia") return { ...shared, color: C.purple, weight: 3, fillColor: C.purple, fillOpacity: 0.05 };
  return { ...shared, color: C.amber, weight: 2, fillColor: C.amber, fillOpacity: 0.06 };
}

function cacheKey(level, dept, prov) {
  return `${level}|${dept || ""}|${prov || ""}`;
}

async function drawBoundary() {
  clearBoundary();

  const { distrito, departamento, provincia } = currentFilters;

  if (distrito && /^\d{6}$/.test(distrito)) {
    const key = cacheKey("distrito", "", distrito);
    if (boundaryCache.has(key)) {
      const geo = boundaryCache.get(key);
      boundaryLayer = L.geoJSON(geo, boundaryStyle("distrito")).addTo(map);
      const b = boundaryLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.1));
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/distritos/${distrito}/geojson`);
      const feature = await resp.json();
      if (!resp.ok) throw new Error(feature?.error || "No se pudo cargar");
      boundaryCache.set(key, feature);
      boundaryLayer = L.geoJSON(feature, boundaryStyle("distrito")).addTo(map);
      const b = boundaryLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.1));
    } catch (e) {
      console.error("Error cargando límite del distrito:", e.message);
    }
    return;
  }

  if (departamento) {
    const key = cacheKey(provincia ? "provincia" : "departamento", departamento, provincia);
    if (boundaryCache.has(key)) {
      const geo = boundaryCache.get(key);
      const level = provincia ? "provincia" : "departamento";
      boundaryLayer = L.geoJSON(geo, boundaryStyle(level)).addTo(map);
      const b = boundaryLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.1));
      return;
    }
    try {
      const params = new URLSearchParams({ departamento });
      if (provincia) params.set("provincia", provincia);
      const resp = await fetch(`${API_BASE}/distritos/geometria/agregada?${params}`);
      const feature = await resp.json();
      if (!resp.ok) throw new Error(feature?.error || "No se pudo cargar");
      boundaryCache.set(key, feature);
      const level = provincia ? "provincia" : "departamento";
      boundaryLayer = L.geoJSON(feature, boundaryStyle(level)).addTo(map);
      const b = boundaryLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.1));
    } catch (e) {
      console.error("Error cargando límite:", e.message);
    }
    return;
  }
}

function showMapStatus(text, isError) {
  const el = $("mapStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
  el.style.display = "block";
}
function hideMapStatus() {
  const el = $("mapStatus");
  if (el) el.style.display = "none";
}

/* ===== carga principal ===== */

async function cargar() {
  try {
    const gravedad = ($("gravedad") || {}).value || null;
    const dept = $("departamentoSelect").value;
    const prov = $("provinciaSelect").value;
    const dist = $("distritoSelect").value;

    currentFilters = { gravedad, departamento: dept, provincia: prov, distrito: dist || null };

    const params = new URLSearchParams();
    if (dist) params.set("distrito", dist);
    if (gravedad) params.set("gravedad", gravedad);
    params.set("verified", "true");

    const resp = await fetch(`${API_BASE}/accidentes/filtrados?${params}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);

    let data = json.data || [];

    if (dept && !dist) {
      data = data.filter(a => {
        const dep = a.raw?.departamento || a.departamento || "";
        return dep === dept;
      });
    }
    if (prov && !dist) {
      data = data.filter(a => {
        const pro = a.provincia || a.raw?.provincia || "";
        return pro === prov;
      });
    }

    renderData(data);
    if (data.length === 0) {
      showMapStatus("No se encontraron accidentes con estos filtros.");
    } else {
      hideMapStatus();
    }
    renderKpis(computeKpis(data));
    await drawBoundary();
    if (!dist) fitMapToVisibleMarkers();
  } catch (e) {
    console.error("Error al cargar accidentes:", e.message);
    showMapStatus("No se pudieron cargar los accidentes. Intenta de nuevo.", true);
  }
}

/* ===== jerarquía ===== */

async function cargarDistritos() {
  try {
    const resp = await fetch(`${API_BASE}/distritos?limit=2000`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);

    const list = Array.isArray(json.data) ? json.data : [];
    for (const d of list) {
      allDistritos.push({
        ubigeo: d.ubigeo,
        departamento: d.departamento,
        provincia: d.provincia,
        distrito: d.distrito,
        label: `${d.departamento} / ${d.provincia} / ${d.distrito}`,
      });
    }
  } catch (e) {
    console.error("Error cargando distritos:", e.message);
  }
}

function buildDeptMap() {
  deptMap = {};
  deptList = [];
  for (const d of allDistritos) {
    if (!deptMap[d.departamento]) {
      deptMap[d.departamento] = {};
      deptList.push(d.departamento);
    }
    if (!deptMap[d.departamento][d.provincia]) {
      deptMap[d.departamento][d.provincia] = [];
    }
    deptMap[d.departamento][d.provincia].push({ ubigeo: d.ubigeo, distrito: d.distrito });
  }
  deptList.sort();
}

function populateDepartamentos() {
  const sel = $("departamentoSelect");
  sel.innerHTML = '<option value="">(Todos los departamentos)</option>';
  for (const d of deptList) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }
}

function populateProvincias(dept) {
  const sel = $("provinciaSelect");
  sel.innerHTML = '<option value="">(Todas las provincias)</option>';
  if (!dept || !deptMap[dept]) return;
  const provs = Object.keys(deptMap[dept]).sort();
  for (const p of provs) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  }
}

function populateDistritos(dept, prov) {
  const sel = $("distritoSelect");
  sel.innerHTML = '<option value="">(Todos los distritos)</option>';
  if (dept && prov && deptMap[dept] && deptMap[dept][prov]) {
    for (const d of deptMap[dept][prov]) {
      const opt = document.createElement("option");
      opt.value = d.ubigeo;
      opt.textContent = d.distrito;
      sel.appendChild(opt);
    }
  }
  const sr = document.createElement("option");
  sr.value = "SRATMA";
  sr.textContent = "SRATMA (Perú)";
  sel.appendChild(sr);
}

/* ===== autocomplete ===== */

function showSuggestions(query) {
  const el = $("suggestions");
  el.innerHTML = "";
  if (!query || query.length < 2) { el.classList.remove("open"); return; }
  const q = query.toLowerCase().trim();

  const seenKeys = new Set();
  const results = [];

  for (const d of allDistritos) {
    const deptLow = d.departamento.toLowerCase();
    const provLow = d.provincia.toLowerCase();
    const distLow = d.distrito.toLowerCase();

    let matchType = null;
    let matchIdx = -1;

    if (deptLow.startsWith(q)) {
      matchType = "Departamento";
      matchIdx = d.label.toLowerCase().indexOf(deptLow);
    } else if (provLow.startsWith(q)) {
      matchType = "Provincia";
      matchIdx = d.label.toLowerCase().indexOf(provLow);
    } else if (distLow.startsWith(q)) {
      matchType = "Distrito";
      matchIdx = d.label.toLowerCase().indexOf(distLow);
    } else {
      const idx = d.label.toLowerCase().indexOf(q);
      if (idx >= 0) {
        matchType = null;
        matchIdx = idx;
      }
    }

    if (matchIdx === -1) continue;

    const key = d.ubigeo + "|" + matchIdx;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    results.push({
      ...d,
      score: matchIdx,
      matchType,
    });
  }

  results.sort((a, b) => a.score - b.score);
  const top = results.slice(0, 20);
  if (top.length === 0) { el.classList.remove("open"); return; }

  for (const m of top) {
    const div = document.createElement("div");
    div.className = "s-item";
    const label = m.label;
    const idx = label.toLowerCase().indexOf(q);
    const seg = q.length;

    const textSpan = document.createElement("span");
    if (idx >= 0) {
      const before = document.createTextNode(label.slice(0, idx));
      const match = document.createElement("span");
      match.className = "match";
      match.textContent = label.slice(idx, idx + seg);
      const after = document.createTextNode(label.slice(idx + seg));
      textSpan.appendChild(before);
      textSpan.appendChild(match);
      textSpan.appendChild(after);
    } else {
      textSpan.textContent = label;
    }
    div.appendChild(textSpan);
    if (m.matchType) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = m.matchType;
      div.appendChild(hint);
    }
    div.addEventListener("click", () => {
      $("departamentoSelect").value = m.departamento;
      populateProvincias(m.departamento);
      $("provinciaSelect").value = m.provincia;
      populateDistritos(m.departamento, m.provincia);
      $("distritoSelect").value = m.ubigeo;
      $("distritoSearch").value = m.distrito;
      $("suggestions").classList.remove("open");
      cargar();
    });
    el.appendChild(div);
  }
  el.classList.add("open");
}

/* ===== drag ===== */

function setupDrag() {
  const controls = $("controls");
  const handle = $("dragHandle");
  let dragging = false, startX, startY, startLeft, startTop;
  let normalised = false;

  function normalisePosition() {
    if (normalised) return;
    normalised = true;
    const ctrlRect = controls.getBoundingClientRect();
    const mapRect = map.getContainer().getBoundingClientRect();
    controls.style.left = (ctrlRect.left - mapRect.left) + "px";
    controls.style.top = (ctrlRect.top - mapRect.top) + "px";
    controls.style.transform = "none";
  }

  function dragStart(clientX, clientY) {
    normalisePosition();
    dragging = true;
    startLeft = controls.offsetLeft;
    startTop = controls.offsetTop;
    startX = clientX;
    startY = clientY;
    controls.style.right = "auto";
  }

  function dragMove(clientX, clientY) {
    if (!dragging) return;
    controls.style.left = (startLeft + clientX - startX) + "px";
    controls.style.top = (startTop + clientY - startY) + "px";
  }

  function dragEnd() { dragging = false; }

  handle.addEventListener("mousedown", (e) => { dragStart(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener("mousemove", (e) => dragMove(e.clientX, e.clientY));
  document.addEventListener("mouseup", dragEnd);

  handle.addEventListener("touchstart", (e) => { dragStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  document.addEventListener("touchmove", (e) => dragMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  document.addEventListener("touchend", dragEnd);
}

function setupThemeToggle() {
  const btn = $("themeToggle");
  const iconSun = $("iconSun");
  const iconMoon = $("iconMoon");
  if (!btn || !iconSun || !iconMoon) return;

  function reflectIcon(theme) {
    if (theme === "light") {
      iconSun.style.display = "none";
      iconMoon.style.display = "block";
    } else {
      iconSun.style.display = "block";
      iconMoon.style.display = "none";
    }
  }

  let theme = getSavedTheme();
  reflectIcon(theme);

  btn.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    applyTileTheme(theme);
    saveTheme(theme);
    reflectIcon(theme);
  });
}

function setupCollapse() {
  const btn = $("collapseBtn");
  const card = $("filterCard");
  if (!btn || !card) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const collapsed = card.classList.toggle("collapsed");
    btn.textContent = collapsed ? "+" : "−";
  });
}

function setupExport() {
  const btn = $("btnExportar");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const params = new URLSearchParams();
    if (currentFilters.distrito) params.set("distrito", currentFilters.distrito);
    if (currentFilters.gravedad) params.set("gravedad", currentFilters.gravedad);
    window.open(`${API_BASE}/accidentes/export?${params}`, "_blank");
  });
}

/* ===== auditoría modal ===== */

async function openAuditModal(id) {
  const overlay = $("auditModal");
  const content = $("auditContent");
  if (!overlay || !content) return;
  content.textContent = "Cargando...";
  overlay.classList.add("open");
  try {
    const resp = await fetch(`${API_BASE}/accidentes/${id}/audit`);
    const json = await resp.json();
    content.textContent = JSON.stringify(json, null, 2);
  } catch (e) {
    content.textContent = "Error al cargar la auditoría.";
  }
}

window.openAuditModal = openAuditModal;

function setupAuditModal() {
  const overlay = $("auditModal");
  const close = $("auditClose");
  if (!overlay || !close) return;
  close.addEventListener("click", () => overlay.classList.remove("open"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
}

/* ===== setup ===== */

function setup() {
  initGlobals();
  setupDrag();
  setupThemeToggle();
  setupCollapse();
  setupExport();
  setupAuditModal();

  const searchInput = $("distritoSearch");
  const deptSel = $("departamentoSelect");
  const provSel = $("provinciaSelect");
  const distritoSel = $("distritoSelect");
  const gravedadSel = $("gravedad");
  const btnCargar = $("btnCargar");

  if (!deptSel || !provSel || !distritoSel || !gravedadSel || !btnCargar || !searchInput) {
    console.error("GeoRisk: elementos del DOM faltantes");
    return;
  }

  searchInput.addEventListener("input", () => showSuggestions(searchInput.value));
  searchInput.addEventListener("blur", () => {
    setTimeout(() => $("suggestions").classList.remove("open"), 200);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = searchInput.value.trim().toLowerCase();
    if (!q || q.length < 2) { cargar(); return; }
    let match = null;
    for (const d of allDistritos) {
      const deptLow = d.departamento.toLowerCase();
      const provLow = d.provincia.toLowerCase();
      const distLow = d.distrito.toLowerCase();
      if (deptLow === q) { match = { level: "departamento", value: d.departamento, ubigeo: null }; break; }
      if (!match && provLow === q) { match = { level: "provincia", value: d.provincia, ubigeo: null, dept: d.departamento }; }
      if (!match && distLow === q) { match = { level: "distrito", value: d.ubigeo, ubigeo: d.ubigeo, dept: d.departamento, prov: d.provincia }; }
    }
    if (match) {
      if (match.level === "departamento") {
        $("departamentoSelect").value = match.value;
        populateProvincias(match.value);
        populateDistritos(match.value, null);
        $("provinciaSelect").value = "";
        $("distritoSelect").value = "";
      } else if (match.level === "provincia") {
        $("departamentoSelect").value = match.dept;
        populateProvincias(match.dept);
        $("provinciaSelect").value = match.value;
        populateDistritos(match.dept, match.value);
        $("distritoSelect").value = "";
      } else if (match.level === "distrito") {
        $("departamentoSelect").value = match.dept;
        populateProvincias(match.dept);
        $("provinciaSelect").value = match.prov;
        populateDistritos(match.dept, match.prov);
        $("distritoSelect").value = match.ubigeo;
      }
      $("distritoSearch").value = q;
      $("suggestions").classList.remove("open");
      cargar();
    } else {
      cargar();
    }
  });

  deptSel.addEventListener("change", () => {
    const dept = deptSel.value;
    populateProvincias(dept);
    populateDistritos(dept, null);
    provSel.value = "";
    distritoSel.value = "";
    cargar();
  });

  provSel.addEventListener("change", () => {
    const dept = deptSel.value;
    const prov = provSel.value;
    populateDistritos(dept, prov || null);
    distritoSel.value = "";
    cargar();
  });

  distritoSel.addEventListener("change", cargar);
  gravedadSel.addEventListener("change", cargar);
  btnCargar.addEventListener("click", cargar);

  (async function init() {
    await cargarDistritos();
    buildDeptMap();
    populateDepartamentos();
    populateProvincias("");
    populateDistritos("", "");
    await cargar();
  })();

  /* ===== SSE + polling fallback ===== */

  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const SSE_BASE = isLocal ? API_BASE : (window.GEORISK_CONFIG?.SSE_BASE || API_BASE);
  let sseFailed = false;

  async function checkApiStatus() {
    try {
      const resp = await fetch(`${API_BASE}/accidentes/stats`, { signal: AbortSignal.timeout(5000) });
      const dot = document.querySelector("#liveIndicator .live-dot");
      if (resp.ok) { if (dot) dot.classList.remove("is-offline"); }
      else { if (dot) dot.classList.add("is-offline"); }
    } catch {
      const dot = document.querySelector("#liveIndicator .live-dot");
      if (dot) dot.classList.add("is-offline");
    }
  }
  checkApiStatus();
  setInterval(checkApiStatus, 30000);

  const evtSource = new EventSource(`${SSE_BASE}/stream/accidentes`);

  evtSource.addEventListener("error", () => {
    if (!sseFailed) {
      sseFailed = true;
      setInterval(cargar, 30000);
    }
  });

  evtSource.addEventListener("accidente_creado", (e) => addLiveAccident(JSON.parse(e.data)));
  evtSource.addEventListener("accidente_simulado", (e) => addLiveAccident(JSON.parse(e.data)));
  evtSource.addEventListener("accidente_ingestado", (e) => addLiveAccident(JSON.parse(e.data)));

  function inc(elId) {
    const el = $(elId);
    if (el) el.textContent = String(Number(el.textContent || "0") + 1);
  }

  function addLiveAccident(acc) {
    const normalized = normalizeAccident(acc);
    if (seenIds.has(normalized.id)) return;
    if (!passesCurrentFilters(normalized)) return;

    seenIds.add(normalized.id);
    markersLayer.addLayer(makeMarker(normalized));

    inc("kpiTotal");
    if (normalized.gravedad === "Baja") inc("kpiBaja");
    if (normalized.gravedad === "Media") inc("kpiMedia");
    if (normalized.gravedad === "Alta") inc("kpiAlta");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setup);
} else {
  setup();
}
