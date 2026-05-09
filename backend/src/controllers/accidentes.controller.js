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
    // publish de evento reactivo
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

module.exports = { getAll, create, getFiltered };