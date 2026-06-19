const {
  listarAccidenteMapa,
  listarAccidenteMapaInformacion,
} = require("../integrations/sratma.client");

const { asyncPool } = require("../utils/pool");
const {
  createAccidente,
  accidenteExists,
  getLastExternalIdByFuente,
  getLastFechaByFuente,
} = require("../services/accidentes.service");
const { startRun, endRun } = require("../services/ingestRuns.service");
const { publish } = require("../reactive/eventBus");

const FUENTE = "SRATMA";

function log(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    source: "sratma",
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

/* ===== utilidades ===== */

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

function safeInt(x) {
  const n = Number(x);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/* ===== mapping enriquecido ===== */

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
  const lesionados =
    safeNumber(pick(det, "nro_lesionado", "lesionados")) ?? 0;

  const ubigeo = normalizeUbigeo(pick(det, "iddist"));
  const distrito_nombre = normalizeDistrictName(pick(det, "distrito"));

  const vehiculos = safeInt(pick(det, "nro_vehiculos"));
  const entidad = pick(det, "entidad") || null;
  const direccion = pick(det, "direccion") || null;
  const codigo_externo = pick(det, "cod_accidente_transito") || null;

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
    vehiculos,
    entidad,
    direccion,
    codigo_externo,
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

/* ===== helpers fechas ===== */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDDMMYYYY(date) {
  const d = new Date(date);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function startOfDayLocal(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildIpInputForDay(baseIpInput, dayDate) {
  const day = formatDDMMYYYY(dayDate);
  return {
    ...baseIpInput,
    fecha_inicial: day,
    fecha_final: day,
  };
}

/* ===== helpers creación accidente ===== */

function buildAccidentePayload(mapped) {
  const distrito = mapped.distrito_nombre || "SRATMA";
  const ubigeo = mapped.ubigeo;

  const gravedad =
    mapped.fallecidos > 0 ? "Alta" : mapped.lesionados > 0 ? "Media" : "Baja";

  return {
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
    vehiculos: mapped.vehiculos,
    entidad: mapped.entidad,
    direccion: mapped.direccion,
    codigo_externo: mapped.codigo_externo,
    raw: mapped.raw,
  };
}

/* ===== procesamiento de un lote de IDs (compartido entre backfill y tick) ===== */

async function processBatch({ ids, concurrency, context }) {
  let created = 0;
  let dup = 0;
  let invalid = 0;
  let errors = 0;

  const results = await asyncPool(concurrency, ids, async (id) => {
    const exists = await accidenteExists({ fuente: FUENTE, external_id: id });
    if (exists) {
      dup++;
      return { status: "duplicate" };
    }

    let det;
    try {
      det = await listarAccidenteMapaInformacion(id);
    } catch (e) {
      errors++;
      log("detail_error", { external_id: id, context, message: e.message });
      return { status: "error", reason: e.message };
    }

    const mapped = mapDetalleToAccidente(det);

    if (
      !mapped.fecha ||
      !mapped.hora ||
      mapped.lat == null ||
      mapped.lng == null
    ) {
      invalid++;
      log("invalid_detail", { external_id: id, context });
      return { status: "invalid" };
    }

    const payload = buildAccidentePayload(mapped);

    try {
      const createdRow = await createAccidente(payload);
      if (!createdRow) {
        dup++;
        return { status: "duplicate_conflict" };
      }
      created++;
      publish({ event: "accidente_ingestado", data: createdRow });
      return { status: "created", id_db: createdRow.id };
    } catch (e) {
      if (e.code === "23505") {
        dup++;
        return { status: "duplicate_conflict" };
      }
      errors++;
      log("create_error", { external_id: id, context, message: e.message });
      return { status: "error", reason: e.message };
    }
  });

  for (const r of results) {
    if (r.status === "rejected") {
      log("batch_item_rejected", {
        context,
        message: r.reason?.message || String(r.reason),
      });
      errors++;
    }
  }

  return { created, dup, invalid, errors, total: ids.length };
}

/* ===== backfill ===== */

async function backfillOnce({ ipInput, concurrency } = {}) {
  const backfillStart = Date.now();

  let lastFecha;
  try {
    lastFecha = await getLastFechaByFuente(FUENTE);
  } catch (e) {
    log("backfill_skip_error_get_last_date", { message: e.message });
    return;
  }

  const today = startOfDayLocal(new Date());

  if (!lastFecha) {
    const defaultDays = Math.min(
      Number(process.env.SRATMA_BACKFILL_DEFAULT_DAYS || 90),
      365,
    );
    lastFecha = addDays(today, -defaultDays);
    log("backfill_default_date", {
      reason: "no_data_in_db",
      defaultDays,
      from: lastFecha.toISOString().slice(0, 10),
    });
  }

  let cursor = addDays(startOfDayLocal(lastFecha), 1);

  if (cursor > today) {
    log("backfill_skip_up_to_date", {
      lastFecha: new Date(lastFecha).toISOString().slice(0, 10),
      today: today.toISOString().slice(0, 10),
    });
    return;
  }

  const maxDaysPerLoop = Math.min(
    Number(process.env.SRATMA_BACKFILL_MAX_DAYS || 90),
    365,
  );

  let totalCreated = 0;
  let loopCount = 0;

  while (cursor <= today) {
    const endDate = addDays(cursor, maxDaysPerLoop - 1);
    const to = endDate < today ? endDate : today;

    log("backfill_loop_start", {
      from: cursor.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      loop: ++loopCount,
    });

    for (let d = new Date(cursor); d <= to; d = addDays(d, 1)) {
    const dayStart = Date.now();
    const dayISO = d.toISOString().slice(0, 10);
    const ipDay = buildIpInputForDay(ipInput, d);

    let run;
    try {
      run = await startRun({
        fuente: FUENTE,
        mode: "backfill",
        range_from: dayISO,
        range_to: dayISO,
        notes: { ddmmyyyy: formatDDMMYYYY(d) },
      });
    } catch (e) {
      log("backfill_run_create_error", { day: dayISO, message: e.message });
    }

    let ids = [];
    try {
      const list = await listarAccidenteMapa(ipDay);
      ids = extractIds(list);
      ids.sort((a, b) => a - b);

      log("backfill_day_list_ok", {
        day: dayISO,
        ddmmyyyy: formatDDMMYYYY(d),
        listed: ids.length,
      });
    } catch (e) {
      log("backfill_day_list_error", { day: dayISO, message: e.message });
      if (run?.id) {
        await endRun({
          id: run.id,
          finished_at: new Date(),
          created: 0,
          duplicates: 0,
          invalid: 0,
          errors: 1,
          listed: null,
          batch: null,
          notes: { error: e.message },
        }).catch(() => {});
      }
      continue;
    }

    if (ids.length === 0) {
      if (run?.id) {
        await endRun({
          id: run.id,
          finished_at: new Date(),
          created: 0,
          duplicates: 0,
          invalid: 0,
          errors: 0,
          listed: 0,
          batch: 0,
        }).catch(() => {});
      }
      continue;
    }

    const maxPerDay = Math.min(
      Number(process.env.SRATMA_BACKFILL_MAX_PER_DAY || 2000),
      5000,
    );
    const batch = ids.slice(-maxPerDay);

    const result = await processBatch({
      ids: batch,
      concurrency,
      context: `backfill:${dayISO}`,
    });

    log("backfill_day_done", {
      day: dayISO,
      batch: batch.length,
      ...result,
      ms: Date.now() - dayStart,
    });

    if (run?.id) {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created: result.created,
        duplicates: result.dup,
        invalid: result.invalid,
        errors: result.errors,
        listed: ids.length,
        batch: batch.length,
      }).catch((e) =>
        log("backfill_run_finish_error", { day: dayISO, message: e.message }),
      );
    }

    totalCreated += result.created;
  }

  cursor = addDays(to, 1);
  }

  log("backfill_done", { ms: Date.now() - backfillStart, totalCreated, loops: loopCount });
}

/* ===== tick ===== */

async function tick({ intervalMs, concurrency, ipInput } = {}) {
  const tickStart = Date.now();

  let run;
  try {
    run = await startRun({
      fuente: FUENTE,
      mode: "tick",
      interval_ms: intervalMs,
    });
  } catch (e) {
    log("tick_run_create_error", { message: e.message });
  }

  let ids = [];
  let last = null;
  try {
    last = await getLastExternalIdByFuente(FUENTE);
    const list = await listarAccidenteMapa(ipInput);
    ids = extractIds(list);
    ids.sort((a, b) => a - b);

    log("tick_list_ok", {
      intervalMs,
      listed: ids.length,
      last_external_id_db: last,
      run_id: run?.id,
    });
  } catch (e) {
    log("tick_list_error", { message: e.message, run_id: run?.id });
    if (run?.id) {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created: 0,
        duplicates: 0,
        invalid: 0,
        errors: 1,
        notes: { error: e.message },
      }).catch(() => {});
    }
    return;
  }

  /* === MEJORA: filtrar IDs no vistos en vez de tomar los últimos N === */
  let unseen = last != null ? ids.filter((id) => id > last) : ids;

  if (unseen.length === 0) {
    log("tick_no_new_ids", {
      run_id: run?.id,
      listed: ids.length,
      last_external_id_db: last,
      ms: Date.now() - tickStart,
    });
    if (run?.id) {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created: 0,
        duplicates: 0,
        invalid: 0,
        errors: 0,
        listed: ids.length,
        batch: 0,
      }).catch(() => {});
    }
    return;
  }

  const maxPerTick = Math.min(
    Number(process.env.SRATMA_MAX_PER_TICK || 200),
    500,
  );
  const batch = unseen.slice(0, maxPerTick);

  const result = await processBatch({
    ids: batch,
    concurrency,
    context: "tick",
  });

  const remaining = unseen.length - batch.length;

  log("tick_done", {
    run_id: run?.id,
    batch: batch.length,
    remaining,
    ...result,
    ms: Date.now() - tickStart,
  });

  if (run?.id) {
    await endRun({
      id: run.id,
      finished_at: new Date(),
      created: result.created,
      duplicates: result.dup,
      invalid: result.invalid,
      errors: result.errors,
      listed: ids.length,
      batch: batch.length,
      notes: remaining > 0 ? { remaining } : undefined,
    }).catch((e) =>
      log("tick_run_finish_error", { message: e.message, run_id: run?.id }),
    );
  }
}

/* ===== periodic backfill (cazar datos atrasados) ===== */

async function periodicBackfill({ ipInput, concurrency } = {}) {
  try {
    const lastFecha = await getLastFechaByFuente(FUENTE);
    if (!lastFecha) {
      log("periodic_backfill_skip", { reason: "no_data_in_db" });
      return;
    }

    const today = startOfDayLocal(new Date());
    const lookbackDays = Math.min(
      Number(process.env.SRATMA_BACKFILL_PERIODIC_DAYS || 3),
      30,
    );
    const from = addDays(today, -lookbackDays);
    const fromDate = new Date(lastFecha);
    const startDate = fromDate > from ? fromDate : from;

    if (startDate >= today) {
      log("periodic_backfill_skip_up_to_date", {
        lastFecha: lastFecha.toISOString().slice(0, 10),
        today: today.toISOString().slice(0, 10),
      });
      return;
    }

    log("periodic_backfill_start", {
      from: startDate.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    });

    const savedCursor = addDays(startDate, 1);
    let cursor = savedCursor;
    let totalCreated = 0;

    while (cursor <= today) {
      const dayISO = cursor.toISOString().slice(0, 10);
      const ipDay = buildIpInputForDay(ipInput, cursor);

      let ids = [];
      try {
        const list = await listarAccidenteMapa(ipDay);
        ids = extractIds(list);
      } catch (e) {
        log("periodic_backfill_day_list_error", { day: dayISO, message: e.message });
        cursor = addDays(cursor, 1);
        continue;
      }

      if (ids.length === 0) {
        cursor = addDays(cursor, 1);
        continue;
      }

      ids.sort((a, b) => a - b);

      const result = await processBatch({
        ids,
        concurrency,
        context: `periodic_backfill:${dayISO}`,
      });

      totalCreated += result.created;
      log("periodic_backfill_day_done", {
        day: dayISO,
        listed: ids.length,
        ...result,
      });

      cursor = addDays(cursor, 1);
    }

    log("periodic_backfill_done", { totalCreated });
  } catch (e) {
    log("periodic_backfill_error", { message: e.message });
  }
}

/* ===== job entry point ===== */

function startSratmaIngestJob({
  intervalMs = 20000,
  concurrency = 5,
  ipInput = defaultIpInput(),
  backfillIntervalMs = Number(process.env.SRATMA_BACKFILL_INTERVAL_MS || 21600000),
} = {}) {
  backfillOnce({ ipInput, concurrency }).finally(() => {
    tick({ intervalMs, concurrency, ipInput });
    setInterval(() => tick({ intervalMs, concurrency, ipInput }), intervalMs);

    setInterval(
      () => periodicBackfill({ ipInput, concurrency }),
      backfillIntervalMs,
    );
  });

  return () => {
    log("job_stop_not_supported", { reason: "interval_handle_not_stored" });
  };
}

module.exports = { startSratmaIngestJob };
