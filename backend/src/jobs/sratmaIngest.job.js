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

function log(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    source: "sratma",
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
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

/* ===== helpers fechas para backfill ===== */
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

function startSratmaIngestJob({
  intervalMs = 20000,
  concurrency = 5,
  ipInput = defaultIpInput(),
} = {}) {
  const FUENTE = "SRATMA";

  let backfillDone = false;

  async function backfillOnce() {
    if (backfillDone) return;
    backfillDone = true;

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
      log("backfill_skip_no_last_date", { reason: "no_data_in_db" });
      return;
    }

    let cursor = addDays(startOfDayLocal(lastFecha), 1);

    if (cursor > today) {
      log("backfill_skip_up_to_date", {
        lastFecha: new Date(lastFecha).toISOString().slice(0, 10),
        today: today.toISOString().slice(0, 10),
      });
      return;
    }

    const maxDays = Math.min(Number(process.env.SRATMA_BACKFILL_MAX_DAYS || 30), 365);
    const endDate = addDays(cursor, maxDays - 1);
    const to = endDate < today ? endDate : today;

    log("backfill_start", {
      from: cursor.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      maxDays,
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

      const maxPerDay = Math.min(
        Number(process.env.SRATMA_BACKFILL_MAX_PER_DAY || 2000),
        5000,
      );
      const batch = ids.slice(-maxPerDay);

      let created = 0;
      let dup = 0;
      let invalid = 0;
      let errors = 0;

      const results = await asyncPool(concurrency, batch, async (id) => {
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
          log("backfill_detail_error", { day: dayISO, external_id: id, message: e.message });
          throw e;
        }

        const mapped = mapDetalleToAccidente(det);

        if (!mapped.fecha || !mapped.hora || mapped.lat == null || mapped.lng == null) {
          invalid++;
          log("backfill_invalid_detail", { day: dayISO, external_id: id });
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
        return { status: "created", id_db: createdRow.id };
      });

      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length) {
        for (const r of rejected) {
          log("backfill_item_rejected", { day: dayISO, message: r.reason?.message || String(r.reason) });
        }
      }

      log("backfill_day_done", {
        day: dayISO,
        batch: batch.length,
        created,
        duplicate_skipped: dup,
        invalid,
        errors,
        ms: Date.now() - dayStart,
      });

      if (run?.id) {
        await endRun({
          id: run.id,
          finished_at: new Date(),
          created,
          duplicates: dup,
          invalid,
          errors,
          listed: ids.length,
          batch: batch.length,
        }).catch((e) => log("backfill_run_finish_error", { day: dayISO, message: e.message }));
      }
    }

    log("backfill_done", { ms: Date.now() - backfillStart });
  }

  async function tick() {
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
    try {
      const last = await getLastExternalIdByFuente(FUENTE);
      const list = await listarAccidenteMapa(ipInput);
      ids = extractIds(list);

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

    ids.sort((a, b) => a - b);

    const maxPerTick = Math.min(Number(process.env.SRATMA_MAX_PER_TICK || 10), 200);
    const batch = ids.slice(-maxPerTick);

    let createdCount = 0;
    let dupSkipCount = 0;
    let invalidCount = 0;
    let errorCount = 0;

    const results = await asyncPool(concurrency, batch, async (id) => {
      const exists = await accidenteExists({ fuente: FUENTE, external_id: id });
      if (exists) {
        dupSkipCount++;
        return { status: "duplicate" };
      }

      let det;
      try {
        det = await listarAccidenteMapaInformacion(id);
      } catch (e) {
        errorCount++;
        log("accident_detail_error", { external_id: id, message: e.message, run_id: run?.id });
        throw e;
      }

      const mapped = mapDetalleToAccidente(det);

      if (!mapped.fecha || !mapped.hora || mapped.lat == null || mapped.lng == null) {
        invalidCount++;
        log("accident_invalid_detail", { external_id: id, run_id: run?.id });
        return { status: "invalid" };
      }

      const distrito = mapped.distrito_nombre || "SRATMA";
      const ubigeo = mapped.ubigeo;

      const gravedad =
        mapped.fallecidos > 0 ? "Alta" : mapped.lesionados > 0 ? "Media" : "Baja";

      const created = await createAccidente({
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

      if (!created) {
        dupSkipCount++;
        return { status: "duplicate_conflict" };
      }

      createdCount++;
      log("accident_created", { external_id: id, id_db: created.id, run_id: run?.id });
      publish({ event: "accidente_ingestado", data: created });
      return { status: "created", id_db: created.id };
    });

    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length) {
      for (const r of rejected) {
        log("tick_item_rejected", { message: r.reason?.message || String(r.reason), run_id: run?.id });
      }
    }

    log("tick_done", {
      run_id: run?.id,
      batch: batch.length,
      created: createdCount,
      duplicate_skipped: dupSkipCount,
      invalid: invalidCount,
      errors: errorCount,
      ms: Date.now() - tickStart,
    });

    if (run?.id) {
      await endRun({
        id: run.id,
        finished_at: new Date(),
        created: createdCount,
        duplicates: dupSkipCount,
        invalid: invalidCount,
        errors: errorCount,
        listed: ids.length,
        batch: batch.length,
      }).catch((e) => log("tick_run_finish_error", { message: e.message, run_id: run?.id }));
    }
  }

  backfillOnce().finally(() => {
    tick();
    setInterval(tick, intervalMs);
  });

  return () => {
    log("job_stop_not_supported", { reason: "interval_handle_not_stored" });
  };
}

module.exports = { startSratmaIngestJob };