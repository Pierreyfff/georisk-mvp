const express = require("express");
const repo = require("../repositories/distritos.repository");

const router = express.Router();

/* =========================
   NUEVO: GeoJSON por ubigeo
   ========================= */
router.get("/:ubigeo/geojson", async (req, res, next) => {
  try {
    const ubigeo = req.params.ubigeo;

    if (!/^\d{6}$/.test(String(ubigeo))) {
      return res.status(400).json({ error: "Ubigeo inválido" });
    }

    const row = await repo.getGeoJsonByUbigeo(ubigeo);

    if (!row) {
      return res.status(404).json({ error: "Distrito no encontrado" });
    }

    // GeoJSON estándar (Feature)
    res.json({
      type: "Feature",
      properties: {
        ubigeo: row.ubigeo,
        distrito: row.distrito,
        provincia: row.provincia,
        departamento: row.departamento,
      },
      geometry: row.geometry,
    });
  } catch (e) {
    next(e);
  }
});

/* =========================
   LISTADO ORIGINAL (sin tocar)
   ========================= */
router.get("/", async (req, res, next) => {
  try {
    const search = req.query.search || null;
    const limit = req.query.limit || 300;

    const data = await repo.list({ search, limit });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;