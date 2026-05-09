const service = require("../services/accidentes.service");
const { publish } = require("./eventBus");

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

const DISTRICTS = [
  { distrito: "Miraflores", ubigeo: "150122", center: [-12.1210, -77.0300] },
  { distrito: "San Isidro", ubigeo: "150131", center: [-12.0970, -77.0369] },
  { distrito: "Santiago de Surco", ubigeo: "150140", center: [-12.1400, -76.9900] },
  { distrito: "La Victoria", ubigeo: "150115", center: [-12.0673, -77.0225] },
  { distrito: "Cercado de Lima", ubigeo: "150101", center: [-12.0464, -77.0428] },
];

function jitterCoord([lat, lng]) {
  return {
    lat: lat + (Math.random() - 0.5) * 0.02,
    lng: lng + (Math.random() - 0.5) * 0.02,
  };
}

function startSimulator({ intervalMs = 5000 } = {}) {
  const tipos = ["Choque", "Atropello", "Volcadura"];
  const gravedades = ["Baja", "Media", "Alta"];

  const timer = setInterval(async () => {
    try {
      const now = new Date();
      const fecha = now.toISOString().slice(0, 10);
      const hora = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

      const chosen = randomFrom(DISTRICTS);
      const { lat, lng } = jitterCoord(chosen.center);

      const accidente = {
        fecha,
        hora,
        distrito: chosen.distrito,
        ubigeo: chosen.ubigeo,
        tipo: randomFrom(tipos),
        gravedad: randomFrom(gravedades),
        lat,
        lng,
      };

      const created = await service.createAccidente(accidente);
      publish({ event: "accidente_simulado", data: created });
    } catch (e) {
      console.error("Simulator error:", e.message);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = { startSimulator };