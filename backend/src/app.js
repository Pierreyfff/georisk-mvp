require("dotenv").config();
require("./reactive/eventBus");

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const { router: accidentesRouter } = require("./routes/accidentes.routes");
const { router: streamRouter } = require("./routes/stream.routes");
const distritosRouter = require("./routes/distritos.routes");
const { router: ingestRunsRouter } = require("./routes/ingestRuns.routes");

const app = express();

/* ===== seguridad ===== */
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:8080" }));
app.use(express.json({ limit: "10kb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." },
});
app.use("/api/", limiter);

/* ===== health ===== */
app.get("/health", async (req, res) => {
  try {
    const { pool } = require("./db/pool");
    const { rows } = await pool.query("SELECT 1 AS ok");
    res.json({ status: "ok", db: rows[0].ok === 1 });
  } catch (e) {
    res.status(503).json({ status: "error", db: false });
  }
});

app.get("/ingest-status", async (req, res) => {
  try {
    const { pool } = require("./db/pool");
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE fuente='SRATMA')::int AS sratma,
        MAX(external_id)::bigint AS max_id,
        MAX(fecha) AS max_fecha
      FROM accidentes
    `);
    res.json(rows[0]);
  } catch (e) {
    res.status(503).json({ error: "no db" });
  }
});

/* ===== routes ===== */
app.use("/api/accidentes", accidentesRouter);
app.use("/api/stream", streamRouter);
app.use("/api/distritos", distritosRouter);
app.use("/api/ingest-runs", ingestRunsRouter);

/* ===== error handler ===== */
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = status === 500 ? "Error interno del servidor." : err.message;
  if (status === 500) console.error("Unhandled error:", err);
  res.status(status).json({ error: message });
});

module.exports = app;
