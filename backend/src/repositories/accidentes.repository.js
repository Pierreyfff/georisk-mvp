const { pool } = require("../db/pool");

function buildWhere({ distrito, gravedad }) {
  const conditions = [];
  const values = [];

  if (distrito) {
    values.push(String(distrito).trim());
    conditions.push(`ubigeo = $${values.length}`);
  }

  if (gravedad) {
    values.push(gravedad);
    conditions.push(`gravedad = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, values };
}

async function findAll() {
  const query = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ORDER BY id;
  `;

  const { rows } = await pool.query(query);
  return rows;
}

async function existsByFuenteExternalId(fuente, externalId) {
  const sql = `
    SELECT 1
    FROM accidentes
    WHERE fuente = $1 AND external_id = $2
    LIMIT 1;
  `;
  const values = [String(fuente), Number(externalId)];
  const { rowCount } = await pool.query(sql, values);
  return rowCount > 0;
}

async function getMaxExternalIdByFuente(fuente) {
  const sql = `
    SELECT MAX(external_id)::bigint AS max_id
    FROM accidentes
    WHERE fuente = $1;
  `;
  const { rows } = await pool.query(sql, [String(fuente)]);
  return rows[0]?.max_id != null ? Number(rows[0].max_id) : null;
}

async function getMaxFechaByFuente(fuente) {
  const sql = `
    SELECT MAX(fecha) AS max_fecha
    FROM accidentes
    WHERE fuente = $1;
  `;
  const { rows } = await pool.query(sql, [String(fuente)]);
  return rows[0]?.max_fecha || null;
}

async function insertOne(accidente) {
  const {
    fecha,
    hora,
    distrito,
    ubigeo,
    tipo,
    gravedad,
    lat,
    lng,
    fallecidos = null,
    lesionados = null,
    fuente = null,
    external_id = null,
    raw = null,
  } = accidente;

  const query = `
    INSERT INTO accidentes (
      fecha, hora, distrito, ubigeo, tipo, gravedad,
      ubicacion,
      fallecidos, lesionados, fuente, external_id, raw
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
      $9, $10, $11, $12, $13
    )
    ON CONFLICT ON CONSTRAINT accidentes_fuente_external_id_key DO NOTHING
    RETURNING
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng;
  `;

  const values = [
    fecha,
    hora,
    distrito,
    ubigeo ? String(ubigeo).trim() : null,
    tipo,
    gravedad,
    lng,
    lat,
    fallecidos,
    lesionados,
    fuente,
    external_id,
    raw,
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function findFiltered({ distrito, gravedad }) {
  const { where, values } = buildWhere({ distrito, gravedad });

  const query = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ${where}
    ORDER BY id;
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

/* ===== audit getters ===== */

async function findById(id) {
  const sql = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [Number(id)]);
  return rows[0] || null;
}

async function findByFuenteExternalId(fuente, externalId) {
  const sql = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    WHERE fuente = $1 AND external_id = $2
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [String(fuente), Number(externalId)]);
  return rows[0] || null;
}

async function findBaseDataset() {
  return findAll();
}

/* ===== Filtros avanzados con paginacion ===== */

function buildAdvancedWhere(filters) {
  const conditions = [];
  const values = [];
  let joinDistritos = false;

  if (filters.distrito) {
    values.push(String(filters.distrito).trim());
    conditions.push(`a.ubigeo = $${values.length}`);
  }

  if (filters.departamento) {
    joinDistritos = true;
    values.push(String(filters.departamento).trim());
    conditions.push(`d.departamento = $${values.length}`);
  }

  if (filters.provincia) {
    joinDistritos = true;
    values.push(String(filters.provincia).trim());
    conditions.push(`d.provincia = $${values.length}`);
  }

  if (filters.gravedad) {
    const gravedadArr = String(filters.gravedad).split(",").map(g => g.trim()).filter(g => g);
    if (gravedadArr.length > 0) {
      const placeholders = gravedadArr.map((_, i) => `$${values.length + i + 1}`).join(", ");
      values.push(...gravedadArr);
      conditions.push(`a.gravedad IN (${placeholders})`);
    }
  }

  if (filters.tipo) {
    const tipoArr = String(filters.tipo).split(",").map(t => t.trim()).filter(t => t);
    if (tipoArr.length > 0) {
      const placeholders = tipoArr.map((_, i) => `$${values.length + i + 1}`).join(", ");
      values.push(...tipoArr);
      conditions.push(`a.tipo IN (${placeholders})`);
    }
  }

  if (filters.fuente) {
    const fuenteArr = String(filters.fuente).split(",").map(f => f.trim()).filter(f => f);
    if (fuenteArr.length > 0) {
      const placeholders = fuenteArr.map((_, i) => `$${values.length + i + 1}`).join(", ");
      values.push(...fuenteArr);
      conditions.push(`a.fuente IN (${placeholders})`);
    }
  }

  if (filters.fecha_desde) {
    values.push(filters.fecha_desde);
    conditions.push(`a.fecha >= $${values.length}`);
  }

  if (filters.fecha_hasta) {
    values.push(filters.fecha_hasta);
    conditions.push(`a.fecha <= $${values.length}`);
  }

  if (filters.lat != null && filters.lng != null && filters.radio_km) {
    const paramIdx = values.length + 1;
    values.push(filters.lng);
    values.push(filters.lat);
    values.push(filters.radio_km * 1000);
    conditions.push(
      `ST_DWithin(a.ubicacion::geometry, ST_SetSRID(ST_MakePoint($${paramIdx}, $${paramIdx + 1}), 4326), ${paramIdx + 2})`
    );
  }

  const tablePrefix = joinDistritos ? "a" : "";
  const joinClause = joinDistritos ? "FROM accidentes a LEFT JOIN distritos d ON a.ubigeo = d.ubigeo" : "FROM accidentes a";
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return { where, values, joinClause, tablePrefix };
}

async function findAdvanced(filters = {}) {
  const {
    distrito,
    departamento,
    provincia,
    gravedad,
    tipo,
    fuente,
    fecha_desde,
    fecha_hasta,
    lat,
    lng,
    radio_km,
    limit = 100,
    offset = 0,
  } = filters;

  const { where, values, joinClause } = buildAdvancedWhere({
    distrito,
    departamento,
    provincia,
    gravedad,
    tipo,
    fuente,
    fecha_desde,
    fecha_hasta,
    lat,
    lng,
    radio_km,
  });

  const limitVal = Number(limit) || 100000;
  const offsetVal = Number(offset) || 0;

  const countQuery = `
    SELECT COUNT(*)::int as total
    ${joinClause}
    ${where};
  `;

  const dataQuery = `
    SELECT
      a.id, a.fecha, a.hora, a.distrito, a.ubigeo, a.tipo, a.gravedad,
      a.fallecidos, a.lesionados, a.fuente, a.external_id, a.raw,
      a.ingested_at, a.updated_at,
      ST_Y(a.ubicacion::geometry) AS lat,
      ST_X(a.ubicacion::geometry) AS lng
    ${joinClause}
    ${where}
    ORDER BY a.fecha DESC, a.hora DESC
    LIMIT ${limitVal} OFFSET ${offsetVal};
  `;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, values),
    pool.query(dataQuery, values),
  ]);

  return {
    data: dataResult.rows,
    pagination: {
      total: countResult.rows[0]?.total || 0,
      limit: limitVal,
      offset: offsetVal,
      hasMore: offsetVal + dataResult.rows.length < countResult.rows[0]?.total,
    },
  };
}

/* ===== GeoJSON nativo ===== */

async function findAsGeoJSON(filters = {}) {
  const {
    distrito,
    gravedad,
    tipo,
    fecha_desde,
    fecha_hasta,
    lat,
    lng,
    radio_km,
    limit = 1000,
  } = filters;

  const { where, values } = buildAdvancedWhere({
    distrito,
    gravedad,
    tipo,
    fecha_desde,
    fecha_hasta,
    lat,
    lng,
    radio_km,
  });

  const limitVal = Number(limit) || 100000;

  const query = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      Fallecidos, lesionados, fuente, external_id,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ${where}
    ORDER BY fecha DESC, hora DESC
    LIMIT ${limitVal};
  `;

  const { rows } = await pool.query(query, values);

  const features = rows.map((row) => ({
    type: "Feature",
    properties: {
      id: row.id,
      fecha: row.fecha,
      hora: row.hora,
      distrito: row.distrito,
      ubigeo: row.ubigeo,
      tipo: row.tipo,
      gravedad: row.gravedad,
      fallecido: row.fallecidos,
      lesionados: row.lesionados,
      fuente: row.fuente,
      external_id: row.external_id,
    },
    geometry: {
      type: "Point",
      coordinates: [row.lng, row.lat],
    },
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

/* ===== Estadisticas ===== */

async function getStatsByPeriod(groupBy, days = 30) {
  let groupExpr, dateExtract;

  switch (groupBy) {
    case "hora":
      groupExpr = "EXTRACT(HOUR FROM hora)::int";
      dateExtract = "hora";
      break;
    case "dia_semana":
      groupExpr = "EXTRACT(DOW FROM fecha)::int";
      dateExtract = "fecha";
      break;
    case "distrito":
      groupExpr = "distrito";
      dateExtract = "fecha";
      break;
    case "tipo":
      groupExpr = "tipo";
      dateExtract = "fecha";
      break;
    case "gravedad":
      groupExpr = "gravedad";
      dateExtract = "fecha";
      break;
    default:
      groupExpr = "fecha";
      dateExtract = "fecha";
  }

  const query = `
    SELECT
      ${groupExpr} as grupo,
      COUNT(*)::int as total,
      SUM(fallecidos)::int as total_fallecidos,
      SUM(lesionados)::int as total_lesionados,
      COUNT(CASE WHEN gravedad = 'Alta' THEN 1 END)::int as alta,
      COUNT(CASE WHEN gravedad = 'Media' THEN 1 END)::int as media,
      COUNT(CASE WHEN gravedad = 'Baja' THEN 1 END)::int as baja
    FROM accidentes
    WHERE fecha >= CURRENT_DATE - INTERVAL '${Number(days) || 30} days'
    GROUP BY ${groupExpr}
    ORDER BY total DESC;
  `;

  const { rows } = await pool.query(query);
  return rows;
}

async function getTopDistritos(days = 30, limit = 10) {
  const query = `
    SELECT
      d.ubigeo,
      d.distrito,
      d.departamento,
      d.provincia,
      COUNT(a.id)::int as total_accidentes,
      SUM(CASE WHEN a.gravedad = 'Alta' THEN 1 ELSE 0 END)::int as accidentes_altos,
      SUM(CASE WHEN a.gravedad = 'Media' THEN 1 ELSE 0 END)::int as accidentes_medios,
      SUM(CASE WHEN a.gravedad = 'Baja' THEN 1 ELSE 0 END)::int as accidentes_bajos,
      SUM(a.fallecidos)::int as total_fallecidos,
      SUM(a.lesionados)::int as total_lesionados
    FROM distritos d
    LEFT JOIN accidentes a ON a.ubigeo = d.ubigeo
      AND a.fecha >= CURRENT_DATE - INTERVAL '${Number(days) || 30} days'
    GROUP BY d.ubigeo, d.distrito, d.departamento, d.provincia
    ORDER BY total_accidentes DESC
    LIMIT ${Number(limit) || 10};
  `;

  const { rows } = await pool.query(query);
  return rows;
}

async function getHeatmapData(fecha_desde, fecha_hasta) {
  const values = [];
  let whereClause = "";

  if (fecha_desde) {
    values.push(fecha_desde);
    whereClause += ` AND fecha >= $${values.length}`;
  }
  if (fecha_hasta) {
    values.push(fecha_hasta);
    whereClause += ` AND fecha <= $${values.length}`;
  }

  const query = `
    SELECT
      ST_X(ubicacion::geometry) as lng,
      ST_Y(ubicacion::geometry) as lat,
      gravedad,
      tipo,
      fecha,
      hora,
      distrito
    FROM accidentes
    WHERE 1=1 ${whereClause}
    ORDER BY fecha DESC;
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

async function getDashboardStats(days = 30) {
  const query = `
    SELECT
      COUNT(*)::int as total_accidentes,
      SUM(fallecidos)::int as total_fallecidos,
      SUM(lesionados)::int as total_lesionados,
      COUNT(CASE WHEN gravedad = 'Alta' THEN 1 END)::int as accidentes_altos,
      COUNT(CASE WHEN gravedad = 'Media' THEN 1 END)::int as accidentes_medios,
      COUNT(CASE WHEN gravedad = 'Baja' THEN 1 END)::int as accidentes_bajos,
      COUNT(DISTINCT distrito)::int as distritos_afectados,
      COUNT(DISTINCT fecha)::int as dias_con_accidentes
    FROM accidentes
    WHERE fecha >= CURRENT_DATE - INTERVAL '${Number(days) || 30} days';
  `;

  const { rows } = await pool.query(query);
  return rows[0];
}

/* ===== BÚSQUEDA FULL-TEXT ===== */

async function search(query, limit = 50) {
  const values = [];
  let whereClause = "";

  if (query) {
    // Búsqueda en múltiples campos
    const searchTerm = `%${String(query).trim().toUpperCase()}%`;
    values.push(searchTerm);
    values.push(searchTerm);
    values.push(searchTerm);
    whereClause = `
      WHERE UPPER(distrito) LIKE $1
        OR UPPER(tipo) LIKE $2
        OR UPPER(raw::text) LIKE $3
    `;
  }

  const sql = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ${whereClause}
    ORDER BY fecha DESC, hora DESC
    LIMIT $${values.length + 1};
  `;

  values.push(Math.min(Number(limit) || 50, 500));

  const { rows } = await pool.query(sql, values);
  return rows;
}

/* ===== ACCIDENTES CERCANOS (RADIO) ===== */

async function findNearby(lat, lng, radiusKm = 5, limit = 50) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Coordenadas inválidas");
  }

  const radiusMeters = Math.max(Number(radiusKm) || 5, 1) * 1000;
  const limitVal = Math.min(Number(limit) || 50, 500);

  const sql = `
    SELECT
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id,
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng,
      ROUND(ST_Distance(ubicacion::geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326))::numeric, 2) AS distance_meters
    FROM accidentes
    WHERE ST_DWithin(
      ubicacion::geometry,
      ST_SetSRID(ST_MakePoint($2, $1), 4326),
      $3
    )
    ORDER BY distance_meters ASC
    LIMIT $4;
  `;

  const { rows } = await pool.query(sql, [lat, lng, radiusMeters, limitVal]);
  return rows;
}

module.exports = {
  findAll,
  existsByFuenteExternalId,
  getMaxExternalIdByFuente,
  getMaxFechaByFuente,
  insertOne,
  findFiltered,
  findById,
  findByFuenteExternalId,
  findBaseDataset,
  findAdvanced,
  findAsGeoJSON,
  getStatsByPeriod,
  getTopDistritos,
  getHeatmapData,
  getDashboardStats,
  search,
  findNearby,
};