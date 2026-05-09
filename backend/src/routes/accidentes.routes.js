const express = require("express");
const controller = require("../controllers/accidentes.controller");

const router = express.Router();

router.get("/", controller.getAll);
router.post("/", controller.create);
router.get("/filtrados", controller.getFiltered);

module.exports = { router };