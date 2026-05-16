const { Server } = require("socket.io");
const { subscribe, publish } = require("./reactive/eventBus");

let io;

function initWs(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const activeFilters = new Map();

  io.on("connection", (socket) => {
    console.log(`[WS] Cliente conectado: ${socket.id}`);

    socket.emit("connected", { socketId: socket.id, ts: Date.now() });

    socket.on("subscribe", (filters) => {
      activeFilters.set(socket.id, filters || {});
      console.log(`[WS] Cliente ${socket.id} subscribio con filtros:`, filters);
      socket.emit("subscribed", { ok: true, filters });
    });

    socket.on("unsubscribe", () => {
      activeFilters.delete(socket.id);
      console.log(`[WS] Cliente ${socket.id} cancelo suscripcion`);
      socket.emit("unsubscribed", { ok: true });
    });

    socket.on("disconnect", (reason) => {
      activeFilters.delete(socket.id);
      console.log(`[WS] Cliente desconectado: ${socket.id}, razon: ${reason}`);
    });

    socket.on("error", (err) => {
      console.error(`[WS] Error en socket ${socket.id}:`, err.message);
    });
  });

  subscribe((event) => {
    const eventName = event.event || "accidente";
    const data = event.data;

    if (!data) return;

    activeFilters.forEach((filters, socketId) => {
      const shouldSend = matchesFilters(data, filters);
      if (shouldSend) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          socket.emit(eventName, data);
        }
      }
    });

    io.emit(eventName, data);
  });

  console.log("[WS] Socket.io inicializado");
  return io;
}

function matchesFilters(data, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) return true;

  if (filters.distrito && data.ubigeo !== filters.distrito) return false;
  if (filters.gravedad && data.gravedad !== filters.gravedad) return false;
  if (filters.tipo && data.tipo !== filters.tipo) return false;

  if (filters.fecha_desde && data.fecha < filters.fecha_desde) return false;
  if (filters.fecha_hasta && data.fecha > filters.fecha_hasta) return false;

  if (filters.lat != null && filters.lng != null && filters.radio_km) {
    const distance = getDistanceFromLatLonInKm(
      data.lat,
      data.lng,
      filters.lat,
      filters.lng
    );
    if (distance > filters.radio_km) return false;
  }

  return true;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function getIO() {
  return io;
}

module.exports = { initWs, getIO };