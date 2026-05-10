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

    const data = await service.getAccidentesFiltrados({ distrito, gravedad });
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

    res.json({
      ok: true,
      accident: row,
      audit: {
        fuente: row.fuente,
        external_id: row.external_id,
        raw: row.raw,
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

    res.json({
      ok: true,
      accident: row,
      audit: {
        fuente: row.fuente,
        external_id: row.external_id,
        raw: row.raw,
      },
    });
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
};