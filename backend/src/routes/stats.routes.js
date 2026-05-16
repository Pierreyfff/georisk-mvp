const express = require("express");
const service = require("../services/accidentes.service");

const router = express.Router();

router.get("/dashboard", async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const stats = await service.getDashboardStats(days);
    res.json({
      ok: true,
      periodo_dias: days,
      ...stats,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/accidentes", async (req, res, next) => {
  try {
    const groupBy = req.query.groupBy || "distrito";
    const days = Number(req.query.days) || 30;
    const stats = await service.getStatsByPeriod(groupBy, days);
    res.json({
      ok: true,
      group_by: groupBy,
      periodo_dias: days,
      data: stats,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/top-distritos", async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const limit = Number(req.query.limit) || 10;
    const stats = await service.getTopDistritos(days, limit);
    res.json({
      ok: true,
      periodo_dias: days,
      data: stats,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/heatmap", async (req, res, next) => {
  try {
    const fecha_desde = req.query.fecha_desde || null;
    const fecha_hasta = req.query.fecha_hasta || null;
    const data = await service.getHeatmapData(fecha_desde, fecha_hasta);
    res.json({
      ok: true,
      total_puntos: data.length,
      fecha_desde,
      fecha_hasta,
      data,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/tipos", async (req, res, next) => {
  try {
    const tipos = await service.getTiposUnicos();
    res.json({
      ok: true,
      tipos,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = { router };