const express = require("express");
const controller = require("../controllers/ingestRuns.controller");

const router = express.Router();

router.get("/", controller.list);
router.get("/:id", controller.getById);

module.exports = { router };