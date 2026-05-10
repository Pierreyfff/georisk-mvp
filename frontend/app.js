const API_BASE = `${location.origin}/api`;

const map = L.map("map").setView([-12.08, -77.03], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

let districtLayer = null;
const districtCache = new Map();

const seenIds = new Set();

const currentFilters = {
  distrito: null,
  gravedad: null,
};

/* ❌ ELIMINADO: UBIGEO_TO_OSM */

/* =========================
   UTILIDADES EXISTENTES
   ========================= */

function gravedadColor(g) {
  if (g === "Alta") return "#e74c3c";
  if (g === "Media") return "#f1c40f";
  return "#2ecc71";
}

function normalizeAccident(acc) {
  return {
    ...acc,
    fecha: String(acc.fecha).slice(0, 10),
    ubigeo: acc.ubigeo != null ? String(acc.ubigeo).trim() : null,
  };
}

function makeMarker(acc) {
  const color = gravedadColor(acc.gravedad);

  const marker = L.circleMarker([acc.lat, acc.lng], {
    radius: 7,
    color,
    weight: 2,
    fillColor: color,
    fillOpacity: 0.65,
  });

  const popup = `
    <b>Accidente #${acc.id}</b><br/>
    <b>Fecha:</b> ${acc.fecha}<br/>
    <b>Hora:</b> ${acc.hora}<br/>
    <b>Distrito:</b> ${acc.distrito}<br/>
    <b>Tipo:</b> ${acc.tipo}<br/>
    <b>Gravedad:</b> ${acc.gravedad}
  `;

  marker.bindPopup(popup);
  return marker;
}

function renderData(data) {
  markersLayer.clearLayers();
  seenIds.clear();

  for (const a of data) {
    const acc = normalizeAccident(a);
    seenIds.add(acc.id);
    markersLayer.addLayer(makeMarker(acc));
  }
}

function renderKpis(kpis) {
  document.getElementById("kpiTotal").textContent = kpis.total;
  document.getElementById("kpiBaja").textContent = kpis.porGravedad.Baja ?? 0;
  document.getElementById("kpiMedia").textContent = kpis.porGravedad.Media ?? 0;
  document.getElementById("kpiAlta").textContent = kpis.porGravedad.Alta ?? 0;
  document.getElementById("kpiProm").textContent = kpis.gravedadPromedio;
}

function getUIFilters() {
  const distritoVal = document.getElementById("distrito").value || null;
  const gravedad = document.getElementById("gravedad").value || null;

  const distrito = distritoVal === "SRATMA" ? null : distritoVal;

  return { distrito, gravedad, distritoVal };
}

function getAccidentUbigeoOrDistrict(acc) {
  if (acc.ubigeo) return String(acc.ubigeo).trim();
  return acc.distrito != null ? String(acc.distrito).trim() : null;
}

function passesCurrentFilters(acc) {
  if (currentFilters.gravedad && acc.gravedad !== currentFilters.gravedad)
    return false;

  if (currentFilters.distrito) {
    if (currentFilters.distrito === "SRATMA") {
      return String(acc.distrito).trim() === "SRATMA";
    }

    const value = getAccidentUbigeoOrDistrict(acc);
    if (value !== String(currentFilters.distrito)) return false;
  }

  return true;
}

function fitMapToVisibleMarkers() {
  const layers = markersLayer.getLayers();
  if (layers.length === 0) return;

  const group = L.featureGroup(layers);
  map.fitBounds(group.getBounds().pad(0.2));
}

function clearDistrictBoundary() {
  if (districtLayer) {
    map.removeLayer(districtLayer);
    districtLayer = null;
  }
}

/* =========================
   🔥 REEMPLAZO COMPLETO
   ========================= */
async function drawSelectedDistrictBoundary() {
  clearDistrictBoundary();

  if (!currentFilters.distrito) return;

  const ubigeo = String(currentFilters.distrito).trim();
  if (ubigeo === "SRATMA") return;
  if (!/^\d{6}$/.test(ubigeo)) return;

  const cacheKey = `UBIGEO|${ubigeo}`;

  if (districtCache.has(cacheKey)) {
    const geo = districtCache.get(cacheKey);

    districtLayer = L.geoJSON(geo, {
      style: {
        color: "#1f2d3d",
        weight: 3,
        dashArray: "6 6",
        fillColor: "#3498db",
        fillOpacity: 0.06,
      },
    }).addTo(map);

    const bounds = districtLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
    return;
  }

  let feature;

  try {
    const resp = await fetch(`${API_BASE}/distritos/${ubigeo}/geojson`);
    feature = await resp.json();

    if (!resp.ok) {
      throw new Error(feature?.error || "No se pudo cargar geojson");
    }
  } catch (e) {
    console.error("No se pudo obtener límite del distrito:", e.message);
    return;
  }

  districtCache.set(cacheKey, feature);

  districtLayer = L.geoJSON(feature, {
    style: {
      color: "#1f2d3d",
      weight: 3,
      dashArray: "6 6",
      fillColor: "#3498db",
      fillOpacity: 0.06,
    },
  }).addTo(map);

  const bounds = districtLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
}

/* =========================
   CARGA PRINCIPAL
   ========================= */
async function cargar() {
  const { distrito, gravedad, distritoVal } = getUIFilters();

  currentFilters.distrito = distritoVal;
  currentFilters.gravedad = gravedad;

  const params = new URLSearchParams();
  if (distrito) params.set("distrito", distrito);
  if (gravedad) params.set("gravedad", gravedad);

  const url = `${API_BASE}/accidentes/filtrados?${params.toString()}`;
  const resp = await fetch(url);
  const json = await resp.json();

  renderData(json.data);
  renderKpis(json.kpis);

  await drawSelectedDistrictBoundary();

  if (!currentFilters.distrito) {
    fitMapToVisibleMarkers();
  }
}

/* =========================
   DISTRIKTOS SELECT
   ========================= */
async function cargarDistritosSelect() {
  const select = document.getElementById("distrito");
  if (!select) return;

  select.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "(Todos)";
  select.appendChild(optAll);

  const optSratma = document.createElement("option");
  optSratma.value = "SRATMA";
  optSratma.textContent = "SRATMA (Perú)";
  select.appendChild(optSratma);

  let json;
  try {
    const resp = await fetch(`${API_BASE}/distritos?limit=2000`);
    json = await resp.json();

    if (!resp.ok) {
      throw new Error(json?.error || `HTTP ${resp.status}`);
    }
  } catch (e) {
    console.error("Error cargando distritos:", e.message);
    return;
  }

  const list = Array.isArray(json.data) ? json.data : [];
  for (const d of list) {
    const opt = document.createElement("option");
    opt.value = d.ubigeo;
    opt.textContent = `${d.departamento} / ${d.provincia} / ${d.distrito}`;
    select.appendChild(opt);
  }
}

/* ========================= */

document.getElementById("btnCargar").addEventListener("click", cargar);

/* 🚀 INIT */
cargarDistritosSelect().then(cargar);

const evtSource = new EventSource(`${API_BASE}/stream/accidentes`);

evtSource.addEventListener("accidente_creado", (e) => {
  addLiveAccident(JSON.parse(e.data));
});

evtSource.addEventListener("accidente_simulado", (e) => {
  addLiveAccident(JSON.parse(e.data));
});

evtSource.addEventListener("accidente_ingestado", (e) => {
  addLiveAccident(JSON.parse(e.data));
});

function inc(elId) {
  const el = document.getElementById(elId);
  el.textContent = String(Number(el.textContent || "0") + 1);
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
