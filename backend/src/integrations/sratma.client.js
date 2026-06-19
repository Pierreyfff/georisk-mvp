const BASE = "https://sratma.mtc.gob.pe/wssratma/api/Mapa";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGetJsonWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "georisk-backend/1.0",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status} ${res.statusText} - ${text.slice(0, 200)}`,
        );
      }

      return res.json();
    } catch (e) {
      const isLast = attempt === retries;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          source: "sratma.client",
          event: isLast ? "api_failed_exhausted" : "api_retry",
          url: url.slice(0, 120),
          attempt,
          retries,
          message: e.message,
        }),
      );
      if (isLast) throw e;
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 7000));
    }
  }
}

function buildUrl(path, ipInputObj) {
  const ipInput = encodeURIComponent(JSON.stringify(ipInputObj));
  return `${BASE}/${path}?ipInput=${ipInput}`;
}

async function listarAccidenteMapa(ipInput) {
  const url = buildUrl("listarAccidenteMapa", ipInput);
  return httpGetJsonWithRetry(url);
}

async function listarAccidenteMapaInformacion(idAccidente) {
  const url = buildUrl("listarAccidenteMapaInformacion", {
    id_accidente_transito: Number(idAccidente),
  });
  return httpGetJsonWithRetry(url);
}

module.exports = {
  listarAccidenteMapa,
  listarAccidenteMapaInformacion,
};
