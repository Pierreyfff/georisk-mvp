const BASE = "https://sratma.mtc.gob.pe/wssratma/api/Mapa";

function buildUrl(path, ipInputObj) {
  const ipInput = encodeURIComponent(JSON.stringify(ipInputObj));
  return `${BASE}/${path}?ipInput=${ipInput}`;
}

async function httpGetJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "georisk-backend/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function listarAccidenteMapa(ipInput) {
  const url = buildUrl("listarAccidenteMapa", ipInput);
  return httpGetJson(url);
}

async function listarAccidenteMapaInformacion(idAccidente) {
  const url = buildUrl("listarAccidenteMapaInformacion", {
    id_accidente_transito: Number(idAccidente),
  });
  return httpGetJson(url);
}

module.exports = {
  listarAccidenteMapa,
  listarAccidenteMapaInformacion,
};