const express = require("express");
const repo = require("../repositories/distritos.repository");

const router = express.Router();

router.get("/departamentos", async (req, res, next) => {
  try {
    const data = await repo.getDepartamentos();
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get("/provincias", async (req, res, next) => {
  try {
    const departamento = req.query.departamento;
    if (!departamento) {
      return res.status(400).json({ error: "departamento es requerido" });
    }
    const data = await repo.getProvincias(departamento);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get("/distritos", async (req, res, next) => {
  try {
    const departamento = req.query.departamento;
    const provincia = req.query.provincia;

    if (!departamento || !provincia) {
      return res
        .status(400)
        .json({ error: "departamento y provincia son requeridos" });
    }

    const data = await repo.getDistritos(departamento, provincia);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

router.get("/departamento/:departamento/geojson", async (req, res, next) => {
  try {
    const departamento = req.params.departamento;
    const geojson = await repo.getGeoJsonByDepartamento(departamento);
    res.json(geojson);
  } catch (e) {
    next(e);
  }
});

router.get("/provincia/:provincia/geojson", async (req, res, next) => {
  try {
    const provincia = req.params.provincia;
    const departamento = req.query.departamento;
    if (!departamento) {
      return res.status(400).json({ error: "departamento es requerido" });
    }
    const geojson = await repo.getGeoJsonByProvincia(provincia, departamento);
    res.json(geojson);
  } catch (e) {
    next(e);
  }
});

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

router.get("/", async (req, res, next) => {
  try {
    const search = req.query.search || null;
    const limit = req.query.limit || 300;
    const departamento = req.query.departamento || null;
    const provincia = req.query.provincia || null;

    const data = await repo.list({ search, limit, departamento, provincia });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;