const express = require("express");
const cors = require("cors");
const { router: accidentesRouter } = require("./routes/accidentes.routes");
const { router: streamRouter } = require("./routes/stream.routes");

// 👉 AGREGAR ESTO
const distritosRouter = require("./routes/distritos.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "georisk-backend" })
);

app.use("/accidentes", accidentesRouter);
app.use("/stream", streamRouter);

// 👉 AGREGAR ESTO
app.use("/distritos", distritosRouter);

// Manejo de errores centralizado
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Error interno",
  });
});

module.exports = { app };