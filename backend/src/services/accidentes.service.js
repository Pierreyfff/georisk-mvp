const repo = require("../repositories/accidentes.repository");

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
  });
}

async function getAccidentesFiltrados({ distrito, gravedad }) {
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

module.exports = {
  getAccidentes,
  createAccidente,
  getAccidentesFiltrados,
  accidenteExists,
  getLastExternalIdByFuente,
  getLastFechaByFuente,
  getAccidenteById,
  getAccidenteByFuenteExternalId,
};