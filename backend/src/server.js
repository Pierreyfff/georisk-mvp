const { app } = require("./app");
require("dotenv").config();

const http = require("http");
const { initWs } = require("./websocket");
const { initRedis, closeRedis } = require("./cache/redis.cache");

const { startSimulator } = require("./reactive/simulator");
const { startSratmaIngestJob } = require("./jobs/sratmaIngest.job");

const port = Number(process.env.PORT || 3000);

const server = http.createServer(app);

initWs(server);

// Inicializar Redis y luego iniciar el servidor
(async () => {
  await initRedis();

  server.listen(port, () => {
    console.log(`GeoRisk API escuchando en http://localhost:${port}`);

    const sim = (process.env.SIMULATOR || "off").toLowerCase();
    if (sim === "on") {
      const intervalMs = Number(process.env.SIMULATOR_INTERVAL_MS || 5000);
      startSimulator({ intervalMs });
      console.log(`Simulador ON cada ${intervalMs}ms`);
    } else {
      console.log("Simulador OFF");
    }

    const sratma = (process.env.SRATMA_INGEST || "off").toLowerCase();
    if (sratma === "on") {
      const intervalMs = Number(process.env.SRATMA_INTERVAL_MS || 20000);
      startSratmaIngestJob({ intervalMs, concurrency: 5 });
      console.log(`SRATMA ingest ON cada ${intervalMs}ms`);
    } else {
      console.log("SRATMA ingest OFF");
    }
  });

  // Cerrar Redis al terminar
  process.on("SIGINT", async () => {
    console.log("\nCerrando...");
    await closeRedis();
    server.close(() => {
      console.log("Servidor cerrado");
      process.exit(0);
    });
  });
})();