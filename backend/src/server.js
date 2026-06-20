const app = require("./app");
require("dotenv").config();

const { startSimulator } = require("./reactive/simulator");
const { startSratmaIngestJob } = require("./jobs/sratmaIngest.job");

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
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
    const concurrency = Number(process.env.SRATMA_CONCURRENCY || 10);
    startSratmaIngestJob({ intervalMs, concurrency });
    console.log(`SRATMA ingest ON cada ${intervalMs}ms (concurrency=${concurrency})`);
  } else {
    console.log("SRATMA ingest OFF");
  }
});