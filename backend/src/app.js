const express = require("express");
const cors = require("cors");
const { pool } = require("./db/pool");
const { router: accidentesRouter } = require("./routes/accidentes.routes");
const { router: streamRouter } = require("./routes/stream.routes");
const distritosRouter = require("./routes/distritos.routes");
const { router: ingestRunsRouter } = require("./routes/ingestRuns.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "georisk-backend" }),
);

app.get("/ingest-status", async (req, res, next) => {
  try {
    const [dbCount, sratmaCount, lastRun] = await Promise.all([
      pool.query(
        "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE fuente='SRATMA')::int AS sratma, MAX(external_id)::bigint AS max_id, MAX(fecha) AS max_fecha FROM accidentes",
      ),
      pool.query(
        "SELECT COALESCE(SUM(created), 0)::int AS total_created, COALESCE(SUM(errors), 0)::int AS total_errors, COUNT(*)::int AS runs FROM ingest_runs",
      ),
      pool.query(
        "SELECT id, fuente, mode, started_at, finished_at, created, errors, notes FROM ingest_runs ORDER BY id DESC LIMIT 1",
      ),
    ]);

    const counts = dbCount.rows[0];
    const agg = sratmaCount.rows[0];

    res.json({
      ok: true,
      database: {
        total_accidentes: counts.total,
        sratma_accidentes: counts.sratma,
        max_external_id: counts.max_id,
        max_fecha: counts.max_fecha,
      },
      ingestion: {
        total_created: agg.total_created,
        total_errors: agg.total_errors,
        total_runs: agg.runs,
      },
      last_run: lastRun.rows[0] || null,
    });
  } catch (e) {
    next(e);
  }
});

app.use("/accidentes", accidentesRouter);
app.use("/stream", streamRouter);
app.use("/distritos", distritosRouter);

// Auditoría de ingestas
app.use("/ingest-runs", ingestRunsRouter);

// Manejo de errores centralizado
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Error interno",
  });
});

module.exports = { app };