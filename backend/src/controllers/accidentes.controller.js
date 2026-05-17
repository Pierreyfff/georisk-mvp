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

async function getAvanzados(req, res, next) {
  try {
    const filters = {
      distrito: req.query.distrito || null,
      departamento: req.query.departamento || null,
      provincia: req.query.provincia || null,
      gravedad: req.query.gravedad || null,
      tipo: req.query.tipo || null,
      fuente: req.query.fuente || null,
      fecha_desde: req.query.fecha_desde || null,
      fecha_hasta: req.query.fecha_hasta || null,
      lat: req.query.lat ? Number(req.query.lat) : null,
      lng: req.query.lng ? Number(req.query.lng) : null,
      radio_km: req.query.radio_km ? Number(req.query.radio_km) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100000,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };

    const result = await service.getAccidentesAvanzados(filters);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

async function getGeoJSON(req, res, next) {
  try {
    const filters = {
      distrito: req.query.distrito || null,
      departamento: req.query.departamento || null,
      provincia: req.query.provincia || null,
      gravedad: req.query.gravedad || null,
      tipo: req.query.tipo || null,
      fuente: req.query.fuente || null,
      fecha_desde: req.query.fecha_desde || null,
      fecha_hasta: req.query.fecha_hasta || null,
      lat: req.query.lat ? Number(req.query.lat) : null,
      lng: req.query.lng ? Number(req.query.lng) : null,
      radio_km: req.query.radio_km ? Number(req.query.radio_km) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100000,
    };

    const geojson = await service.getAccidentesGeoJSON(filters);
    res.setHeader("Content-Type", "application/vnd.geo+json");
    res.json(geojson);
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

async function search(req, res, next) {
  try {
    const query = req.query.q || "";
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    if (!query || query.trim().length === 0) {
      return res.json([]);
    }

    const results = await service.searchAccidentes(query, limit);
    res.json(results);
  } catch (e) {
    next(e);
  }
}

async function nearby(req, res, next) {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const radiusKm = req.query.radio ? Number(req.query.radio) : 5;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat y lng son requeridos (números)" });
    }

    const results = await service.getNearbyAccidentes(lat, lng, radiusKm, limit);
    res.json(results);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getAll,
  create,
  getFiltered,
  getAvanzados,
  getGeoJSON,
  getAuditById,
  getAuditByFuenteExternal,
  search,
  nearby,
};