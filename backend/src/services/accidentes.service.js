const repo = require("../repositories/accidentes.repository");
const redisCache = require("../cache/redis.cache");

const GRAVEDADES_VALIDAS = new Set(["Baja", "Media", "Alta"]);

/* ===== Cache Functions (ahora con Redis) ===== */
async function getCache(key) {
  return await redisCache.get(key);
}

async function setCache(key, data, ttlType = "accidentes_list") {
  await redisCache.set(key, data, ttlType);
}

async function invalidateCache(prefix) {
  await redisCache.invalidateByPrefix(prefix);
}

function isValidLatLng(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

async function getAccidentes() {
  return repo.findAll();
}

async function accidenteExists({ fuente, external_id }) {
  if (!fuente || external_id == null) return false;
  return repo.existsByFuenteExternalId(fuente, external_id);
}

async function getLastExternalIdByFuente(fuente) {
  if (!fuente) return null;
  return repo.getMaxExternalIdByFuente(fuente);
}

async function getLastFechaByFuente(fuente) {
  if (!fuente) return null;
  return repo.getMaxFechaByFuente(fuente);
}

async function getAccidenteById(id) {
  const row = await repo.findById(id);
  return row;
}

async function getAccidenteByFuenteExternalId(fuente, external_id) {
  const row = await repo.findByFuenteExternalId(fuente, external_id);
  return row;
}

async function createAccidente(accidente) {
  const {
    fecha,
    hora,
    distrito,
    ubigeo,
    tipo,
    gravedad,
    lat,
    lng,
    Fallecidos,
    lesionados,
    fuente,
    external_id,
    raw,
  } = accidente;

  if (!fecha || !hora || !distrito || !tipo || !gravedad) {
    const err = new Error("Faltan campos obligatorios.");
    err.status = 400;
    throw err;
  }

  if (ubigeo != null) {
    const u = String(ubigeo).trim();
    if (!/^\d{6}$/.test(u)) {
      const err = new Error("Ubigeo inválido. Debe tener 6 dígitos.");
      err.status = 400;
      throw err;
    }
  }

  if (!GRAVEDADES_VALIDAS.has(gravedad)) {
    const err = new Error("Gravedad inválida. Use: Baja | Media | Alta.");
    err.status = 400;
    throw err;
  }

  if (!isValidLatLng(lat, lng)) {
    const err = new Error("Coordenadas inválidas (lat/lng).");
    err.status = 400;
    throw err;
  }

  const created = await repo.insertOne({
    fecha,
    hora,
    distrito,
    ubigeo: ubigeo || null,
    tipo,
    gravedad,
    lat,
    lng,
    Fallecidos: Fallecidos ?? null,
    lesionados: lesionados ?? null,
    fuente: fuente ?? null,
    external_id: external_id ?? null,
    raw: raw ?? null,
  });

  invalidateCache("stats:");
  invalidateCache("distritos:");

  return created;
}

async function getAccidentesFiltrados({ distrito, gravedad }) {
  const cacheKey = `filtered:${distrito || "all"}:${gravedad || "all"}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const base = await repo.findFiltered({ distrito, gravedad });

  const gravedadScore = (g) => (g === "Baja" ? 1 : g === "Media" ? 2 : 3);

  const data = base.map((a) => {
    const fechaISO = new Date(a.fecha).toISOString().slice(0, 10);

    return {
      ...a,
      fecha: fechaISO,
      gravedadScore: gravedadScore(a.gravedad),
      timestampLocal: `${fechaISO} ${a.hora}`,
    };
  });

  const initial = {
    total: 0,
    sumaGravedadScore: 0,
    porGravedad: { Baja: 0, Media: 0, Alta: 0 },
    porTipo: {},
  };

  const acc = data.reduce((state, item) => {
    return {
      total: state.total + 1,
      sumaGravedadScore: state.sumaGravedadScore + item.gravedadScore,
      porGravedad: {
        ...state.porGravedad,
        [item.gravedad]: (state.porGravedad[item.gravedad] || 0) + 1,
      },
      porTipo: {
        ...state.porTipo,
        [item.tipo]: (state.porTipo[item.tipo] || 0) + 1,
      },
    };
  }, initial);

  const gravedadPromedio =
    acc.total === 0 ? 0 : Number((acc.sumaGravedadScore / acc.total).toFixed(2));

  const result = {
    filters: {
      distrito: distrito || null,
      gravedad: gravedad || null,
    },
    data,
    kpis: {
      total: acc.total,
      porGravedad: acc.porGravedad,
      porTipo: acc.porTipo,
      gravedadPromedio,
    },
  };

  await setCache(cacheKey, result, "accidentes_filtered");
  return result;
}

/* ===== Filtros avanzados ===== */

async function getAccidentesAvanzados(filters = {}) {
  const cacheKey = `advanced:${JSON.stringify(filters)}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.findAdvanced(filters);
  await setCache(cacheKey, result, 30000);
  return result;
}

/* ===== GeoJSON nativo ===== */

async function getAccidentesGeoJSON(filters = {}) {
  const cacheKey = `geojson:${JSON.stringify(filters)}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.findAsGeoJSON(filters);
  await setCache(cacheKey, result, "accidentes_filtered");
  return result;
}

/* ===== Estadisticas ===== */

async function getStatsByPeriod(groupBy, days = 30) {
  const cacheKey = `stats:period:${groupBy}:${days}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.getStatsByPeriod(groupBy, days);
  await setCache(cacheKey, result, "stats_dashboard");
  return result;
}

async function getTopDistritos(days = 30, limit = 10) {
  const cacheKey = `stats:topdistritos:${days}:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.getTopDistritos(days, limit);
  await setCache(cacheKey, result, "stats_dashboard");
  return result;
}

async function getHeatmapData(fecha_desde, fecha_hasta) {
  const cacheKey = `stats:heatmap:${fecha_desde}:${fecha_hasta}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.getHeatmapData(fecha_desde, fecha_hasta);
  await setCache(cacheKey, result, "stats_dashboard");
  return result;
}

async function getDashboardStats(days = 30) {
  const cacheKey = `stats:dashboard:${days}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const result = await repo.getDashboardStats(days);
  await setCache(cacheKey, result, "stats_dashboard");
  return result;
}

/* ===== Tipos unicos para filtros ===== */

async function getTiposUnicos() {
  const cacheKey = "tipos:unicos";
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const query = `
    SELECT DISTINCT tipo
    FROM accidentes
    WHERE tipo IS NOT NULL
    ORDER BY tipo;
  `;
  const { pool } = require("../db/pool");
  const { rows } = await pool.query(query);
  const result = rows.map((r) => r.tipo);
  await setCache(cacheKey, result, "distritos");
  return result;
}

/* ===== BÚSQUEDA ===== */

async function searchAccidentes(query, limit = 50) {
  if (!query || String(query).trim().length === 0) {
    return [];
  }

  const result = await repo.search(query, limit);
  return result;
}

/* ===== ACCIDENTES CERCANOS ===== */

async function getNearbyAccidentes(lat, lng, radiusKm = 5, limit = 50) {
  if (!isValidLatLng(lat, lng)) {
    const err = new Error("Coordenadas inválidas (lat/lng)");
    err.status = 400;
    throw err;
  }

  const result = await repo.findNearby(lat, lng, radiusKm, limit);
  return result;
}

module.exports = {
  getAccidentes,
  createAccidente,
  getAccidentesFiltrados,
  getAccidentesAvanzados,
  getAccidentesGeoJSON,
  getStatsByPeriod,
  getTopDistritos,
  getHeatmapData,
  getDashboardStats,
  getTiposUnicos,
  invalidateCache,
  accidenteExists,
  getLastExternalIdByFuente,
  getLastFechaByFuente,
  getAccidenteById,
  getAccidenteByFuenteExternalId,
  searchAccidentes,
  getNearbyAccidentes,
};