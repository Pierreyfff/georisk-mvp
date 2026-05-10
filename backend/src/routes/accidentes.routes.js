const express = require("express");
const controller = require("../controllers/accidentes.controller");

const router = express.Router();

router.get("/", controller.getAll);
router.post("/", controller.create);
router.get("/filtrados", controller.getFiltered);

// Auditoría (veracidad)
router.get("/:id/audit", controller.getAuditById);
router.get("/external/:fuente/:external_id/audit", controller.getAuditByFuenteExternal);

module.exports = { router };