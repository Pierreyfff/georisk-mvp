/**
 * Script de Backfill de 6 meses
 * 
 * Uso:
 *   docker exec -it georisk-backend node src/scripts/backfill6meses.js
 * 
 * Este script carga datos históricos de 180 días atrás hacia hoy,
 * respetando el rate limit del API SRATMA con delays de 500ms entre requests.
 */

require("dotenv").config();

const dayjs = require("dayjs");
const { pool } = require("../db/pool");

const {
  listarAccidenteMapa,
  listarAccidenteMapaInformacion,
} = require("../integrations/sratma.client");

const {
  createAccidente,
  accidenteExists,
} = require("../services/accidentes.service");

const { startRun, endRun } = require("../services/ingestRuns.service");
const { asyncPool } = require("../utils/pool");

const FUENTE = "SRATMA";
const DIAS = 180;
const DELAY_MS = 500; // Esperar entre requests para no saturar API
const MAX_PER_DAY = 2000;
const CONCURRENCY = 3;

function log(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    source: "backfill6meses",
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDDMMYYYY(date) {
  const d = dayjs(date);
  return `${pad2(d.date())}/${pad2(d.month() + 1)}/${d.year()}`;
}

function formatYYYYMMDD(date) {
  const d = dayjs(date);
  return d.format("YYYY-MM-DD");
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

function buildIpInputForDay(baseIpInput, dayDate) {
  const day = formatDDMMYYYY(dayDate);
  return {
    ...baseIpInput,
    fecha_inicial: day,
    fecha_final: day,
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

function normalizeUbigeo(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return /^\d{6}$/.test(s) ? s : null;
}

function normalizeDistrictName(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
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
  const ubigeo = normalizeUbigeo(pick(det, "iddist"));
  const distrito_nombre = normalizeDistrictName(pick(det, "distrito"));

  return {
    external_id: Number(id),
    tipo_externo: String(tipo),
    fecha,
    hora,
    lat,
    lng,
    fallecidos: Number.isFinite(fallecidos) ? fallecidos : 0,
    lesionados: Number.isFinite(lesionados) ? lesionados : 0,
    ubigeo,
    distrito_nombre,
    raw: det,
  };
}

async function ingestDay(dayDate, ipInputBase) {
  const dayISO = formatYYYYMMDD(dayDate);
  const dayDDMMYYYY = formatDDMMYYYY(dayDate);

  // Crear registro de ingestión
  let run;
  try {
    run = await startRun({
      fuente: FUENTE,
      mode: "backfill",
      range_from: dayISO,
      range_to: dayISO,
    });
  } catch (e) {
    log("run_create_error", { day: dayISO, message: e.message });
    return { created: 0, duplicates: 0, invalid: 0, errors: 1 };
  }

  // Listar accidentes del día
  const ipDay = buildIpInputForDay(ipInputBase, dayDate);

  let ids = [];
  try {
    const list = await listarAccidenteMapa(ipDay);
    ids = extractIds(list);
    ids.sort((a, b) => a - b);

    log("day_list_ok", { day: dayISO, count: ids.length });
  } catch (e) {
    log("day_list_error", { day: dayISO, message: e.message });
    if (run?.id) {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created: 0,
        duplicates: 0,
        invalid: 0,
        errors: 1,
      }).catch(() => {});
    }
    return { created: 0, duplicates: 0, invalid: 0, errors: 1 };
  }

  // Procesar máximo X accidentes por día
  const batch = ids.slice(-MAX_PER_DAY);

  let created = 0;
  let dup = 0;
  let invalid = 0;
  let errors = 0;

  const results = await asyncPool(CONCURRENCY, batch, async (id) => {
    try {
      const exists = await accidenteExists({ fuente: FUENTE, external_id: id });
      if (exists) {
        dup++;
        return { status: "duplicate" };
      }

      let det;
      try {
        det = await listarAccidenteMapaInformacion(id);
        await sleep(DELAY_MS); // Respetar rate limit
      } catch (e) {
        errors++;
        log("detail_error", { day: dayISO, id, message: e.message });
        throw e;
      }

      const mapped = mapDetalleToAccidente(det);

      if (!mapped.fecha || !mapped.hora || mapped.lat == null || mapped.lng == null) {
        invalid++;
        return { status: "invalid" };
      }

      const distrito = mapped.distrito_nombre || "SRATMA";
      const ubigeo = mapped.ubigeo;
      const gravedad =
        mapped.fallecidos > 0 ? "Alta" : mapped.lesionados > 0 ? "Media" : "Baja";

      const createdRow = await createAccidente({
        fecha: mapped.fecha,
        hora: mapped.hora,
        distrito,
        ubigeo,
        tipo: mapped.tipo_externo,
        gravedad,
        lat: mapped.lat,
        lng: mapped.lng,
        fallecidos: mapped.fallecidos,
        lesionados: mapped.lesionados,
        fuente: FUENTE,
        external_id: mapped.external_id,
        raw: mapped.raw,
      });

      if (!createdRow) {
        dup++;
        return { status: "duplicate_conflict" };
      }

      created++;
      return { status: "created" };
    } catch (e) {
      errors++;
      return { status: "error", error: e.message };
    }
  });

  // Finalizar registro de ingestión
  if (run?.id) {
    try {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created,
        duplicates: dup,
        invalid,
        errors,
      });
    } catch (e) {
      log("run_end_error", { day: dayISO, message: e.message });
    }
  }

  log("day_complete", {
    day: dayISO,
    created,
    duplicates: dup,
    invalid,
    errors,
  });

  return { created, duplicates: dup, invalid, errors };
}

async function main() {
  log("backfill_start", { dias: DIAS, delay_ms: DELAY_MS });

  const today = dayjs();
  const ipInputBase = defaultIpInput();

  let totalCreated = 0;
  let totalDuplicates = 0;
  let totalInvalid = 0;
  let totalErrors = 0;

  // Iterar días hacia atrás
  for (let i = DIAS; i >= 0; i--) {
    const dayDate = today.subtract(i, "day");
    const dayISO = formatYYYYMMDD(dayDate);

    process.stdout.write(`[${DIAS - i + 1}/${DIAS + 1}] Procesando ${dayISO}... `);

    try {
      const stats = await ingestDay(dayDate.toDate(), ipInputBase);
      totalCreated += stats.created;
      totalDuplicates += stats.duplicates;
      totalInvalid += stats.invalid;
      totalErrors += stats.errors;

      console.log(`✓ (${stats.created} nuevos)`);

      // Esperar un poco entre días para no sobrecargar
      if (i > 0) await sleep(100);
    } catch (e) {
      console.log(`✗ Error: ${e.message}`);
      totalErrors++;
    }
  }

  log("backfill_complete", {
    dias_procesados: DIAS + 1,
    created: totalCreated,
    duplicates: totalDuplicates,
    invalid: totalInvalid,
    errors: totalErrors,
  });

  console.log(`
╔════════════════════════════════════════╗
║  Backfill de 6 meses completado       ║
╠════════════════════════════════════════╣
║ Nuevos:      ${String(totalCreated).padEnd(8)}           ║
║ Duplicados:  ${String(totalDuplicates).padEnd(8)}           ║
║ Inválidos:   ${String(totalInvalid).padEnd(8)}           ║
║ Errores:     ${String(totalErrors).padEnd(8)}           ║
╚════════════════════════════════════════╝
  `);

  await pool.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
