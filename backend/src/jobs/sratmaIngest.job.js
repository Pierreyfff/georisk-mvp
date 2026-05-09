const {
  listarAccidenteMapa,
  listarAccidenteMapaInformacion,
} = require("../integrations/sratma.client");

const { asyncPool } = require("../utils/pool");
const { createAccidente } = require("../services/accidentes.service");
const { publish } = require("../reactive/eventBus");

// 🔥 DEBUG agregado (justo después del require)
console.log("DEBUG accidentes.service exports:", require("../services/accidentes.service"));
console.log("DEBUG typeof createAccidente:", typeof createAccidente);

function safeNumber(x) {
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

function toDateYYYYMMDD(value) {
  if (!value) return null;
  const s = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return s.slice(0, 10);
}

function toTimeHHMMSS(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

function mapDetalleToAccidente(det) {
  const id = pick(det, "id_accidente_transito", "id_accidente", "id");
  const tipo =
    pick(det, "clase_accidente", "tipo", "descripcion_accidente") ||
    "Accidente";

  const fecha = toDateYYYYMMDD(
    pick(det, "fecha_registro", "fecha", "fecha_accidente"),
  );

  const hora = toTimeHHMMSS(
    pick(det, "hora_registro", "hora", "hora_accidente"),
  );

  const lat = safeNumber(pick(det, "latitud", "lat"));
  const lng = safeNumber(pick(det, "longitud", "lng"));

  const fallecidos = safeNumber(pick(det, "nro_fallecido", "fallecidos")) ?? 0;
  const lesionados = safeNumber(pick(det, "nro_lesionado", "lesionados")) ?? 0;

  return {
    external_id: Number(id),
    tipo_externo: String(tipo),
    fecha,
    hora,
    lat,
    lng,
    fallecidos: Number.isFinite(fallecidos) ? fallecidos : 0,
    lesionados: Number.isFinite(lesionados) ? lesionados : 0,
    raw: det,
  };
}

function defaultIpInput() {
  return {
    cod_accidente_transito: "",
    cod_ubigeo: "",
    codruta: "",
    codrutanacional: "",
    codrutadepartamental: "",
    codrutavecinal: "",
    fecha_inicial: null,
    fecha_final: null,
    mayor30: false,
    waze: false,
    comisaria: false,
    puentes: false,
    peajes: false,
    anio: 0,
    redvial: false,
    concesionados: false,
    id_clase_accidente: 0,
    otros_clase_accidente: "",
    redvialDepartamental: false,
    redvialNacional: false,
    redvialVecinal: false,
    es_dsv: true,
    es_concesionaria: true,
    es_pnp: true,
    es_serenazgo: true,
    tramosTca: true,
  };
}

function extractIds(listJson) {
  const features = listJson?.accidente?.features || [];
  const ids = [];

  for (const f of features) {
    const id = f?.properties?.id_accidente;
    if (id != null) ids.push(Number(id));
  }

  return ids.filter((x) => Number.isFinite(x));
}

function startSratmaIngestJob({
  intervalMs = 20000,
  concurrency = 5,
  ipInput = defaultIpInput(),
} = {}) {
  const idsProcesados = new Set();

  async function tick() {
    let ids;

    try {
      const list = await listarAccidenteMapa(ipInput);
      ids = extractIds(list);
    } catch (e) {
      console.error("SRATMA listarAccidenteMapa error:", e.message);
      return;
    }

    const nuevos = ids.filter((id) => !idsProcesados.has(id));

    console.log("SRATMA list ids:", ids.length, "nuevos:", nuevos.length);

    if (nuevos.length === 0) return;

    const maxPerTick = Number(process.env.SRATMA_MAX_PER_TICK || 10);
    const batch = nuevos.slice(0, maxPerTick);

    batch.forEach((id) => idsProcesados.add(id));

    const results = await asyncPool(concurrency, batch, async (id) => {
      console.log("SRATMA ingestado id:", id);

      const det = await listarAccidenteMapaInformacion(id);
      const mapped = mapDetalleToAccidente(det);

      if (
        !mapped.fecha ||
        !mapped.hora ||
        mapped.lat == null ||
        mapped.lng == null
      ) {
        throw new Error(`Detalle incompleto para id=${id}`);
      }

      const distrito = "SRATMA";
      const gravedad =
        mapped.fallecidos > 0
          ? "Alta"
          : mapped.lesionados > 0
            ? "Media"
            : "Baja";

      const created = await createAccidente({
        fecha: mapped.fecha,
        hora: mapped.hora,
        distrito,
        ubigeo: null,
        tipo: mapped.tipo_externo,
        gravedad,
        lat: mapped.lat,
        lng: mapped.lng,
        fallecidos: mapped.fallecidos,
        lesionados: mapped.lesionados,
        fuente: "SRATMA",
        external_id: mapped.external_id,
        raw: mapped.raw,
      });

      publish({ event: "accidente_ingestado", data: created });
      return created;
    });

    const rejected = results.filter((r) => r.status === "rejected");

    if (rejected.length) {
      for (const r of rejected) {
        console.error("SRATMA ingest error:", r.reason?.message || r.reason);
      }
    }
  }

  const timer = setInterval(tick, intervalMs);
  tick();

  return () => clearInterval(timer);
}

module.exports = { startSratmaIngestJob };