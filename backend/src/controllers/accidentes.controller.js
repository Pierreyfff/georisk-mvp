const service = require("../services/accidentes.service");
const { publish } = require("../reactive/eventBus");

async function getAll(req, res, next) {
  try {
    const data = await service.getAccidentes();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const created = await service.createAccidente(req.body);
    publish({ event: "accidente_creado", data: created });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
}

async function getFiltered(req, res, next) {
  try {
    const distrito = req.query.distrito ? String(req.query.distrito).trim() : null;
    const gravedad = req.query.gravedad ? String(req.query.gravedad).trim() : null;
    const verified = req.query.verified === "true" || req.query.verified === "1";

    const data = await service.getAccidentesFiltrados({ distrito, gravedad, verified });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

/* ===== NUEVO: auditoría ===== */

async function getAuditById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const row = await service.getAccidenteById(id);
    if (!row) return res.status(404).json({ error: "Accidente no encontrado" });

    const { raw, ...safeAccident } = row;
    res.json({
      ok: true,
      accident: safeAccident,
      audit: {
        fuente: row.fuente,
        external_id: row.external_id,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function getAuditByFuenteExternal(req, res, next) {
  try {
    const fuente = String(req.params.fuente || "").trim();
    const externalId = Number(req.params.external_id);

    if (!fuente) return res.status(400).json({ error: "fuente inválida" });
    if (!Number.isFinite(externalId) || externalId <= 0) {
      return res.status(400).json({ error: "external_id inválido" });
    }

    const row = await service.getAccidenteByFuenteExternalId(fuente, externalId);
    if (!row) return res.status(404).json({ error: "Accidente no encontrado" });

    const { raw, ...safeAccident } = row;
    res.json({
      ok: true,
      accident: safeAccident,
      audit: {
        fuente: row.fuente,
        external_id: row.external_id,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function getReconciliation(req, res, next) {
  try {
    const data = await service.getReconciliation();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function getStats(req, res, next) {
  try {
    const stats = await service.getVerifiedStats();
    res.json(stats);
  } catch (e) {
    next(e);
  }
}

function toCsv(rows) {
  const headers = ["id","fecha","hora","distrito","provincia","departamento","tipo","gravedad","fallecidos","lesionados","vehiculos"];
  const escape = (val) => {
    const s = val == null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.fecha, r.hora, r.distrito,
      r.raw?.provincia || "", r.raw?.departamento || "",
      r.tipo, r.gravedad, r.fallecidos ?? "", r.lesionados ?? "", r.vehiculos ?? ""
    ].map(escape).join(","));
  }
  return lines.join("\n");
}

async function exportCsv(req, res, next) {
  try {
    const distrito = req.query.distrito ? String(req.query.distrito).trim() : null;
    const gravedad = req.query.gravedad ? String(req.query.gravedad).trim() : null;

    const result = await service.getAccidentesFiltrados({ distrito, gravedad });
    const rows = result.data || [];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=georisk_export.csv");
    res.send(toCsv(rows));
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getAll,
  create,
  getFiltered,
  getAuditById,
  getAuditByFuenteExternal,
  getStats,
  getReconciliation,
  exportCsv,
};