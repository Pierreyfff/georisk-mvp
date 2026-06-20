const repo = require("../repositories/accidentes.repository");
const distritosRepo = require("../repositories/distritos.repository");
const { listarAccidenteMapa } = require("../integrations/sratma.client");
const sratmaCache = require("../integrations/sratmaCache");

function extractIds(listJson) {
  const features = listJson?.accidente?.features || [];
  const ids = [];
  for (const f of features) {
    const id = f?.properties?.id_accidente;
    if (id != null) ids.push(Number(id));
  }
  return ids.filter((x) => Number.isFinite(x));
}

const GRAVEDADES_VALIDAS = new Set(["Baja", "Media", "Alta"]);

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

/* ===== NUEVO: audit getters ===== */
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
    fallecidos,
    lesionados,
    fuente,
    external_id,
    raw,
    vehiculos,
    entidad,
    direccion,
    codigo_externo,
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

  return repo.insertOne({
    fecha,
    hora,
    distrito,
    ubigeo: ubigeo || null,
    tipo,
    gravedad,
    lat,
    lng,
    fallecidos: fallecidos ?? null,
    lesionados: lesionados ?? null,
    fuente: fuente ?? null,
    external_id: external_id ?? null,
    raw: raw ?? null,
    vehiculos: vehiculos ?? null,
    entidad: entidad ?? null,
    direccion: direccion ?? null,
    codigo_externo: codigo_externo ?? null,
  });
}

async function getAccidentesFiltrados({ distrito, gravedad, verified }) {
  let base = await repo.findFiltered({ distrito, gravedad });

  if (verified === "true" || verified === true) {
    const activeSet = sratmaCache.getActiveIds();
    if (activeSet.size > 0) {
      base = base.filter((a) => a.external_id != null && activeSet.has(Number(a.external_id)));
    }
  }

  const gravedadScore = (g) => (g === "Baja" ? 1 : g === "Media" ? 2 : 3);

  const data = base.map((a) => {
    const fechaISO = new Date(a.fecha).toISOString().slice(0, 10);
    const provincia = a.raw?.provincia || null;
    const departamento = a.raw?.departamento || null;

    const { raw, ...safe } = a;
    return {
      ...safe,
      provincia,
      departamento,
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

  return {
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
}

async function getReconciliation() {
  const stats = await repo.getStats();
  const lastFetch = sratmaCache.getLastFetch();
  const verifiedCount = sratmaCache.getCount();
  return {
    dbTotal: stats.totalAccidentes,
    sratmaListed: verifiedCount || null,
    sratmaError: null,
    verified: verifiedCount > 0 ? stats.totalAccidentes === verifiedCount : null,
    checkedAt: lastFetch ? lastFetch.toISOString() : new Date().toISOString(),
  };
}

async function getStats() {
  const [accStats, totalDepartamentos] = await Promise.all([
    repo.getStats(),
    distritosRepo.countDepartamentos(),
  ]);
  return { ...accStats, totalDepartamentos };
}

async function getVerifiedStats() {
  const stats = await getStats();
  const lastFetch = sratmaCache.getLastFetch();
  const verifiedCount = sratmaCache.getCount();
  return {
    ...stats,
    totalAccidentes: verifiedCount > 0 ? verifiedCount : stats.totalAccidentes,
    ultimaActualizacion: lastFetch ? lastFetch.toISOString() : stats.ultimaActualizacion,
    reconcile: {
      dbTotal: stats.totalAccidentes,
      sratmaListed: verifiedCount,
      sratmaError: null,
      verified: verifiedCount > 0 ? stats.totalAccidentes === verifiedCount : null,
      checkedAt: lastFetch ? lastFetch.toISOString() : null,
    },
  };
}

module.exports = {
  getAccidentes,
  createAccidente,
  getAccidentesFiltrados,
  accidenteExists,
  getLastExternalIdByFuente,
  getLastFechaByFuente,
  getAccidenteById,
  getAccidenteByFuenteExternalId,
  getStats,
  getVerifiedStats,
  getReconciliation,
};