const service = require("../services/ingestRuns.service");

async function list(req, res, next) {
  try {
    const fuente = req.query.fuente ? String(req.query.fuente).trim() : null;
    const mode = req.query.mode ? String(req.query.mode).trim() : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const rows = await service.listRuns({ fuente, mode, limit });
    res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
}

async function getById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const row = await service.getRunById(id);
    if (!row) return res.status(404).json({ error: "Run no encontrado" });

    res.json({ ok: true, data: row });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, getById };