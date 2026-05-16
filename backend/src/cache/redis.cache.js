const { createClient } = require("redis");

let redisClient = null;
let isConnected = false;

// TTL configurables por tipo de caché (en segundos)
const TTL_CONFIG = {
  accidentes_list: 30,
  accidentes_filtered: 30,
  stats_dashboard: 120,
  departamentos: 3600,
  provincias: 3600,
  distritos: 3600,
  geojson_departamento: 3600,
  geojson_provincia: 3600,
  geojson_distrito: 3600,
};

async function initRedis() {
  if (isConnected) return;

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    redisClient = createClient({ url: redisUrl });
    
    redisClient.on("error", (err) => {
      console.error("[Redis] Error:", err);
      isConnected = false;
    });

    redisClient.on("connect", () => {
      console.log("[Redis] Conectado");
      isConnected = true;
    });

    await redisClient.connect();
  } catch (err) {
    console.error("[Redis] Fallo la conexión:", err);
    isConnected = false;
  }
}

async function get(key) {
  if (!isConnected || !redisClient) return null;

  try {
    const value = await redisClient.get(key);
    if (value) {
      return JSON.parse(value);
    }
  } catch (err) {
    console.error(`[Redis] Error al leer ${key}:`, err);
  }

  return null;
}

async function set(key, data, ttlType = "accidentes_list") {
  if (!isConnected || !redisClient) return;

  try {
    const ttl = TTL_CONFIG[ttlType] || 60;
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (err) {
    console.error(`[Redis] Error al escribir ${key}:`, err);
  }
}

async function del(key) {
  if (!isConnected || !redisClient) return;

  try {
    await redisClient.del(key);
  } catch (err) {
    console.error(`[Redis] Error al eliminar ${key}:`, err);
  }
}

async function delPattern(pattern) {
  if (!isConnected || !redisClient) return;

  try {
    // Buscar todas las keys que coincidan con el patrón
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (err) {
    console.error(`[Redis] Error al eliminar patrón ${pattern}:`, err);
  }
}

async function invalidateByPrefix(prefix) {
  if (!isConnected || !redisClient) return;

  try {
    await delPattern(`${prefix}*`);
  } catch (err) {
    console.error(`[Redis] Error al invalidar ${prefix}:`, err);
  }
}

async function closeRedis() {
  if (redisClient && isConnected) {
    try {
      await redisClient.disconnect();
      isConnected = false;
      console.log("[Redis] Desconectado");
    } catch (err) {
      console.error("[Redis] Error al desconectar:", err);
    }
  }
}

module.exports = {
  initRedis,
  get,
  set,
  del,
  delPattern,
  invalidateByPrefix,
  closeRedis,
  TTL_CONFIG,
};
