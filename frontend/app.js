const API_BASE = `${location.origin}/api`;

const map = L.map("map").setView([-12.0464, -77.0428], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Marker Cluster Group para rendimiento
const markerClusterGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 50,
  showCoverageOnHover: true,
  zoomToBoundsOnClick: true,
});
map.addLayer(markerClusterGroup);

let districtLayer = null;
let departamentoLayer = null;
let heatmapLayer = null;
let isHeatmapMode = false;

const districtCache = new Map();
const seenIds = new Set();
let socket = null;
let allAccidents = [];

const currentFilters = {
  departamento: null,
  provincia: null,
  distrito: null,
  gravedad: [],
  tipo: [],
  fuente: [],
  fecha_desde: null,
  fecha_hasta: null,
};

function gravedadColor(g) {
  if (g === "Alta") return "#ef4444";
  if (g === "Media") return "#f59e0b";
  return "#22c55e";
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
  const radiusByGravedad = acc.gravedad === "Alta" ? 8 : acc.gravedad === "Media" ? 6 : 4;
  
  const marker = L.circleMarker([acc.lat, acc.lng], {
    radius: radiusByGravedad,
    color: "#fff",
    weight: 1,
    fillColor: color,
    fillOpacity: 0.85,
  });

  // Popup detallado y atractivo
  const popup = `
    <div style="width: 280px; font-family: Inter, sans-serif;">
      <div style="background: ${color}; color: white; padding: 12px; border-radius: 8px 8px 0 0; margin: -4px -4px 0 -4px;">
        <strong>${acc.tipo}</strong>
        <span style="float: right; background: rgba(255,255,255,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">
          ${acc.gravedad}
        </span>
      </div>
      <div style="padding: 12px;">
        <table style="width: 100%; font-size: 12px; line-height: 1.6;">
          <tr>
            <td style="color: #64748b;">📅 Fecha:</td>
            <td style="font-weight: 600;">${acc.fecha}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">🕒 Hora:</td>
            <td style="font-weight: 600;">${acc.hora}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">📍 Distrito:</td>
            <td style="font-weight: 600;">${acc.distrito || "N/A"}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">💀 Fallecidos:</td>
            <td style="font-weight: 600; color: #ef4444;">${acc.fallecidos ?? 0}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">🏥 Lesionados:</td>
            <td style="font-weight: 600; color: #f59e0b;">${acc.lesionados ?? 0}</td>
          </tr>
          <tr>
            <td style="color: #64748b;">🔗 Fuente:</td>
            <td style="font-weight: 600;">${acc.fuente} #${acc.external_id}</td>
          </tr>
        </table>
      </div>
    </div>
  `;

  marker.bindPopup(popup, { maxWidth: 300 });
  return marker;
}

function renderData(data) {
  markerClusterGroup.clearLayers();
  seenIds.clear();

  for (const a of data) {
    const acc = normalizeAccident(a);
    seenIds.add(acc.id);
    markerClusterGroup.addLayer(makeMarker(acc));
  }

  if (data.length > 0) {
    const bounds = markerClusterGroup.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.05));
    }
  }
}

function renderKpis(data) {
  const total = data.length;
  const alta = data.filter(a => a.gravedad === "Alta").length;
  const media = data.filter(a => a.gravedad === "Media").length;
  const baja = data.filter(a => a.gravedad === "Baja").length;

  document.getElementById("kpiTotal").textContent = total;
  document.getElementById("kpiAlta").textContent = alta;
  document.getElementById("kpiMedia").textContent = media;
  document.getElementById("kpiBaja").textContent = baja;
}

function getUIFilters() {
  return {
    departamento: document.getElementById("departamento").value || null,
    provincia: document.getElementById("provincia").value || null,
    distrito: document.getElementById("distrito").value || null,
    gravedad: Array.from(document.querySelectorAll('input[name="gravedad"]:checked')).map(e => e.value),
    tipo: Array.from(document.querySelectorAll('input[name="tipo"]:checked')).map(e => e.value),
    fuente: Array.from(document.querySelectorAll('input[name="fuente"]:checked')).map(e => e.value),
    fecha_desde: document.getElementById("fecha_desde").value || null,
    fecha_hasta: document.getElementById("fecha_hasta").value || null,
  };
}

function passesCurrentFilters(acc) {
  if (currentFilters.distrito && acc.ubigeo !== currentFilters.distrito) return false;
  if (currentFilters.gravedad.length > 0 && !currentFilters.gravedad.includes(acc.gravedad)) return false;
  if (currentFilters.tipo.length > 0 && !currentFilters.tipo.includes(acc.tipo)) return false;
  if (currentFilters.fuente.length > 0 && acc.fuente && !currentFilters.fuente.includes(acc.fuente)) return false;
  if (currentFilters.fecha_desde && acc.fecha < currentFilters.fecha_desde) return false;
  if (currentFilters.fecha_hasta && acc.fecha > currentFilters.fecha_hasta) return false;
  return true;
}

function clearGeographicLayers() {
  if (districtLayer) {
    map.removeLayer(districtLayer);
    districtLayer = null;
  }
  if (departamentoLayer) {
    map.removeLayer(departamentoLayer);
    departamentoLayer = null;
  }
}

async function loadGeoForDepartamento(departamento) {
  clearGeographicLayers();
  if (!departamento) return;

  try {
    const resp = await fetch(`${API_BASE}/distritos/departamento/${encodeURIComponent(departamento)}/geojson`);
    if (resp.ok) {
      const geojson = await resp.json();
      departamentoLayer = L.geoJSON(geojson, {
        style: { color: "#3b82f6", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.1 },
      }).addTo(map);
      const bounds = departamentoLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
    }
  } catch (e) {
    console.error("Error cargando departamento:", e);
  }
}

async function loadGeoForProvincia(provincia, departamento) {
  clearGeographicLayers();
  if (!provincia) return;

  try {
    const resp = await fetch(`${API_BASE}/distritos/provincia/${encodeURIComponent(provincia)}/geojson?departamento=${encodeURIComponent(departamento)}`);
    if (resp.ok) {
      const geojson = await resp.json();
      departamentoLayer = L.geoJSON(geojson, {
        style: { color: "#8b5cf6", weight: 2, fillColor: "#8b5cf6", fillOpacity: 0.1 },
      }).addTo(map);
      const bounds = departamentoLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
    }
  } catch (e) {
    console.error("Error cargando provincia:", e);
  }
}

async function loadGeoForDistrito(ubigeo) {
  clearGeographicLayers();
  if (!ubigeo) return;

  try {
    const resp = await fetch(`${API_BASE}/distritos/${ubigeo}/geojson`);
    if (resp.ok) {
      const geojson = await resp.json();
      districtLayer = L.geoJSON(geojson, {
        style: { color: "#1f2d3d", weight: 3, dashArray: "6 6", fillColor: "#3498db", fillOpacity: 0.15 },
      }).addTo(map);
      const bounds = districtLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
    }
  } catch (e) {
    console.error("Error cargando distrito:", e);
  }
}

function applyClientFilters() {
  const filtered = allAccidents.filter(passesCurrentFilters);
  renderData(filtered);
  renderKpis(filtered);
}

async function cargar() {
  showLoading(true);

  try {
    const filtros = getUIFilters();
    Object.assign(currentFilters, filtros);

    const params = new URLSearchParams();
    if (filtros.distrito) params.set("distrito", filtros.distrito);
    if (filtros.departamento) params.set("departamento", filtros.departamento);
    if (filtros.provincia) params.set("provincia", filtros.provincia);
    if (filtros.gravedad.length > 0) params.set("gravedad", filtros.gravedad.join(","));
    if (filtros.tipo.length > 0) params.set("tipo", filtros.tipo.join(","));
    if (filtros.fuente.length > 0) params.set("fuente", filtros.fuente.join(","));
    if (filtros.fecha_desde) params.set("fecha_desde", filtros.fecha_desde);
    if (filtros.fecha_hasta) params.set("fecha_hasta", filtros.fecha_hasta);
    params.set("limit", 10000);

    const url = `${API_BASE}/accidentes/avanzados?${params.toString()}`;
    const resp = await fetch(url);
    const json = await resp.json();

    allAccidents = json.data || [];
    renderData(allAccidents);
    renderKpis(allAccidents);

    if (filtros.distrito) {
      await loadGeoForDistrito(filtros.distrito);
    } else if (filtros.provincia) {
      await loadGeoForProvincia(filtros.provincia, filtros.departamento);
    } else if (filtros.departamento) {
      await loadGeoForDepartamento(filtros.departamento);
    }

    if (socket && socket.connected) {
      socket.emit("subscribe", filtros);
    }
  } catch (e) {
    console.error("Error cargando:", e);
  } finally {
    showLoading(false);
  }
}

async function cargarDepartamentos() {
  try {
    const resp = await fetch(`${API_BASE}/distritos/departamentos`);
    const json = await resp.json();
    const select = document.getElementById("departamento");
    select.innerHTML = '<option value="">Todos los departamentos</option>';
    if (json.data) {
      for (const d of json.data) {
        const opt = document.createElement("option");
        opt.value = d.departamento;
        opt.textContent = d.departamento;
        select.appendChild(opt);
      }
    }
  } catch (e) {
    console.error("Error cargando departamentos:", e);
  }
}

async function cargarProvincias(departamento) {
  const select = document.getElementById("provincia");
  select.innerHTML = '<option value="">Todas las provincias</option>';
  document.getElementById("distrito").innerHTML = '<option value="">Todos los distritos</option>';

  if (!departamento) return;

  try {
    const resp = await fetch(`${API_BASE}/distritos/provincias?departamento=${encodeURIComponent(departamento)}`);
    const json = await resp.json();
    if (json.data) {
      for (const p of json.data) {
        const opt = document.createElement("option");
        opt.value = p.provincia;
        opt.textContent = p.provincia;
        select.appendChild(opt);
      }
    }
  } catch (e) {
    console.error("Error cargando provincias:", e);
  }
}

async function cargarDistritos(provincia, departamento) {
  const select = document.getElementById("distrito");
  select.innerHTML = '<option value="">Cargando...</option>';

  if (!provincia || !departamento) {
    select.innerHTML = '<option value="">Todos los distritos</option>';
    return;
  }

  try {
    // Usar nuevo endpoint de cascada
    const resp = await fetch(`${API_BASE}/distritos?departamento=${encodeURIComponent(departamento)}&provincia=${encodeURIComponent(provincia)}`);
    const json = await resp.json();
    select.innerHTML = '<option value="">Todos los distritos</option>';
    if (json.data) {
      for (const d of json.data) {
        const opt = document.createElement("option");
        opt.value = d.ubigeo;
        opt.textContent = d.distrito;
        select.appendChild(opt);
      }
    }
  } catch (e) {
    console.error("Error cargando distritos:", e);
    select.innerHTML = '<option value="">Error al cargar</option>';
  }
}

async function cargarTipos() {
  try {
    const resp = await fetch(`${API_BASE}/stats/tipos`);
    const json = await resp.json();
    const container = document.getElementById("tipos-checkboxes");
    container.innerHTML = "";
    if (json.tipos && Array.isArray(json.tipos)) {
      for (const t of json.tipos) {
        const label = document.createElement("label");
        label.style.display = "inline-flex";
        label.style.alignItems = "center";
        label.style.marginRight = "12px";
        label.style.fontSize = "12px";
        label.innerHTML = `<input type="checkbox" name="tipo" value="${t}" style="margin-right:4px">${t}`;
        container.appendChild(label);
      }
    }
  } catch (e) {
    console.error("Error cargando tipos:", e);
  }
}

async function cargarEstadisticas() {
  const panel = document.getElementById("panel-estadisticas");
  panel.classList.add("visible");

  try {
    const [dashboard, topDistritos, tiposData] = await Promise.all([
      fetch(`${API_BASE}/stats/dashboard?days=365`).then(r => r.json()),
      fetch(`${API_BASE}/stats/top-distritos?days=365&limit=15`).then(r => r.json()),
      fetch(`${API_BASE}/stats/tipos`).then(r => r.json()),
    ]);

    // Actualizar gráfico de gravedad
    document.getElementById("stat-alta").textContent = dashboard.accidentes_altos || 0;
    document.getElementById("stat-media").textContent = dashboard.accidentes_medios || 0;
    document.getElementById("stat-baja").textContent = dashboard.accidentes_bajos || 0;

    const total = (dashboard.accidentes_altos || 0) + (dashboard.accidentes_medios || 0) + (dashboard.accidentes_bajos || 0);
    if (total > 0) {
      document.querySelector("#chart-gravedad .alta").style.width = `${(dashboard.accidentes_altos / total) * 100}%`;
      document.querySelector("#chart-gravedad .media").style.width = `${(dashboard.accidentes_medios / total) * 100}%`;
      document.querySelector("#chart-gravedad .baja").style.width = `${(dashboard.accidentes_bajos / total) * 100}%`;
    }

    // Top Distritos con provincia y región
    const container = document.getElementById("top-distritos");
    container.innerHTML = "";
    if (topDistritos.data && Array.isArray(topDistritos.data)) {
      for (const d of topDistritos.data) {
        const div = document.createElement("div");
        div.className = "top-distrito";
        div.style.cssText = "padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; cursor: pointer;";
        div.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: #1e293b;">${d.distrito}</div>
              <div style="font-size: 11px; color: #94a3b8;">${d.provincia} • ${d.departamento}</div>
            </div>
            <div style="text-align: right; font-weight: 700; color: #3b82f6; font-size: 14px;">${d.total_accidentes}</div>
          </div>
        `;
        div.onmouseover = () => div.style.background = "#f8fafc";
        div.onmouseout = () => div.style.background = "transparent";
        div.onclick = () => {
          document.getElementById("distrito").value = d.ubigeo || d.distrito;
          document.getElementById("provincia").value = d.provincia || "";
          document.getElementById("departamento").value = d.departamento || "";
          cargarProvincias(d.departamento);
          cargarDistritos(d.provincia, d.departamento);
          cargar();
          panel.classList.remove("visible");
        };
        container.appendChild(div);
      }
    }

    // Top Tipos de Accidentes
    const tiposContainer = document.getElementById("top-tipos");
    if (tiposContainer) {
      tiposContainer.innerHTML = "";
      if (tiposData.data && Array.isArray(tiposData.data)) {
        for (const t of tiposData.data.slice(0, 8)) {
          const div = document.createElement("div");
          div.className = "top-tipo";
          div.style.cssText = "padding: 8px 0; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; font-size: 12px;";
          div.innerHTML = `<span style="color: #334155;">${t.tipo}</span><span style="font-weight: 600; color: #1e293b;">${t.total_accidentes}</span>`;
          tiposContainer.appendChild(div);
        }
      }
    }
  } catch (e) {
    console.error("Error cargando estadísticas:", e);
  }
}

async function descargarGeoJSON() {
  const filtros = getUIFilters();
  const params = new URLSearchParams();
  if (filtros.distrito) params.set("distrito", filtros.distrito);
  if (filtros.gravedad.length > 0) params.set("gravedad", filtros.gravedad.join(","));
  if (filtros.tipo.length > 0) params.set("tipo", filtros.tipo.join(","));
  if (filtros.fecha_desde) params.set("fecha_desde", filtros.fecha_desde);
  if (filtros.fecha_hasta) params.set("fecha_hasta", filtros.fecha_hasta);
  params.set("limit", 10000);

  try {
    const resp = await fetch(`${API_BASE}/accidentes/geojson?${params.toString()}`);
    const geojson = await resp.json();

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accidentes-${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Error descargando GeoJSON:", e);
  }
}

function initWebSocket() {
  socket = io();

  socket.on("connect", () => {
    document.getElementById("ws-status").textContent = "WS: Conectado";
    document.getElementById("ws-status").className = "connected";
    socket.emit("subscribe", currentFilters);
    updateStatusBar();
  });

  socket.on("disconnect", () => {
    document.getElementById("ws-status").textContent = "WS: Desconectado";
    document.getElementById("ws-status").className = "disconnected";
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.textContent = "🔴 Desconectado";
  });

  socket.on("accidente_creado", (data) => addLiveAccident(data));
  socket.on("accidente_ingestado", (data) => addLiveAccident(data));
  socket.on("accidente_simulado", (data) => addLiveAccident(data));
}

function inc(elId) {
  const el = document.getElementById(elId);
  el.textContent = String(Number(el.textContent || "0") + 1);
}

function addLiveAccident(acc) {
  const normalized = normalizeAccident(acc);

  allAccidents.push(normalized);
  seenIds.add(normalized.id);

  if (passesCurrentFilters(normalized)) {
    markerClusterGroup.addLayer(makeMarker(normalized));
  }

  const totalEl = document.getElementById("kpiTotal");
  totalEl.textContent = String(Number(totalEl.textContent) + 1);

  if (normalized.gravedad === "Baja") inc("kpiBaja");
  if (normalized.gravedad === "Media") inc("kpiMedia");
  if (normalized.gravedad === "Alta") inc("kpiAlta");

  updateStatusBar();
}

function toggleHeatmap() {
  if (isHeatmapMode) {
    // Mostrar markers (volver a clustering)
    map.removeLayer(heatmapLayer);
    map.addLayer(markerClusterGroup);
    isHeatmapMode = false;
    document.getElementById("btnHeatmap").textContent = "🔥 Calor";
    document.getElementById("btnHeatmap").classList.remove("active");
  } else {
    // Mostrar heatmap mejorado
    const heatData = allAccidents
      .filter(passesCurrentFilters)
      .map(a => {
        let intensity = 0.4;
        if (a.gravedad === "Alta") intensity = 1.0;
        else if (a.gravedad === "Media") intensity = 0.7;
        else if (a.gravedad === "Baja") intensity = 0.4;
        // Intensificar por lesionados
        const lesionados = parseInt(a.lesionados) || 0;
        intensity = Math.min(1.0, intensity + (lesionados * 0.1));
        return [a.lat, a.lng, intensity];
      });
    
    if (heatmapLayer) map.removeLayer(heatmapLayer);
    heatmapLayer = L.heatLayer(heatData, {
      radius: 30,
      blur: 20,
      maxZoom: 18,
      minOpacity: 0.25,
      gradient: {
        0.0: "#00ff00", // Verde para baja intensidad
        0.33: "#ffff00", // Amarillo
        0.66: "#ff9900", // Naranja
        1.0: "#ff0000"   // Rojo para alta intensidad
      }
    }).addTo(map);
    map.removeLayer(markerClusterGroup);
    isHeatmapMode = true;
    document.getElementById("btnHeatmap").textContent = "🗺️ Mapa";
    document.getElementById("btnHeatmap").classList.add("active");
  }
}

function updateStatusBar() {
  const filtered = allAccidents.filter(passesCurrentFilters);
  const lastTime = allAccidents.length > 0 ? "hace <1 min" : "nunca";
  const statusText = `🟢 Conectado | Último: ${lastTime} | En vista: ${filtered.length} | ⚡ Tiempo real activo`;
  const statusBar = document.getElementById("status-bar");
  if (statusBar) statusBar.textContent = statusText;
}

function togglePanelEstadisticas() {
  const panel = document.getElementById("panel-estadisticas");
  if (panel) {
    panel.classList.toggle("visible");
  }
}

function showLoading(show) {
  document.getElementById("loading-overlay").classList.toggle("visible", show);
}

function limpiarFiltros() {
  document.getElementById("departamento").value = "";
  document.getElementById("provincia").value = "";
  document.getElementById("distrito").value = "";
  document.getElementById("fecha_desde").value = "";
  document.getElementById("fecha_hasta").value = "";
  document.querySelectorAll('input[name="gravedad"]').forEach(e => e.checked = false);
  document.querySelectorAll('input[name="tipo"]').forEach(e => e.checked = false);
  document.querySelectorAll('input[name="fuente"]').forEach(e => e.checked = false);

  clearGeographicLayers();
  map.setView([-12.0464, -77.0428], 6);

  Object.keys(currentFilters).forEach(k => currentFilters[k] = Array.isArray(currentFilters[k]) ? [] : null);

  cargar();
}

function setFechaRapida(periodo) {
  const hoy = new Date();
  let desde = new Date();

  switch (periodo) {
    case "hoy":
      desde = new Date(hoy);
      break;
    case "7d":
      desde.setDate(hoy.getDate() - 7);
      break;
    case "30d":
      desde.setDate(hoy.getDate() - 30);
      break;
    case "90d":
      desde.setDate(hoy.getDate() - 90);
      break;
    case "1y":
      desde.setFullYear(hoy.getFullYear() - 1);
      break;
  }

  document.getElementById("fecha_desde").value = desde.toISOString().slice(0, 10);
  document.getElementById("fecha_hasta").value = hoy.toISOString().slice(0, 10);
  cargar();
}

document.getElementById("btnCargar").addEventListener("click", cargar);
document.getElementById("btnLimpiar").addEventListener("click", limpiarFiltros);
document.getElementById("btnHeatmap").addEventListener("click", toggleHeatmap);
document.getElementById("btnEstadisticas").addEventListener("click", cargarEstadisticas);
document.getElementById("btnGeoJSON").addEventListener("click", descargarGeoJSON);

document.getElementById("departamento").addEventListener("change", async (e) => {
  await cargarProvincias(e.target.value);
  cargar();
});

document.getElementById("provincia").addEventListener("change", async (e) => {
  const depto = document.getElementById("departamento").value;
  await cargarDistritos(e.target.value, depto);
  cargar();
});

document.getElementById("distrito").addEventListener("change", cargar);

document.querySelectorAll('input[name="gravedad"]').forEach(e => e.addEventListener("change", applyClientFilters));
document.querySelectorAll('input[name="tipo"]').forEach(e => e.addEventListener("change", applyClientFilters));
document.querySelectorAll('input[name="fuente"]').forEach(e => e.addEventListener("change", applyClientFilters));

cargarDepartamentos().then(cargarTipos).then(cargar);
initWebSocket();