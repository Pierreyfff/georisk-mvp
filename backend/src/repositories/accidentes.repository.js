const { pool } = require("../db/pool");

function buildWhere({ distrito, gravedad }) {
  const conditions = [];
  const values = [];

  if (distrito) {
    const val = String(distrito).trim();
    if (val === "SRATMA") {
      values.push(val);
      conditions.push(`distrito = $${values.length}`);
    } else {
      values.push(val);
      conditions.push(`ubigeo = $${values.length}`);
    }
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
      vehiculos, entidad, direccion, codigo_externo,
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
    vehiculos = null,
    entidad = null,
    direccion = null,
    codigo_externo = null,
  } = accidente;

  const query = `
    INSERT INTO accidentes (
      fecha, hora, distrito, ubigeo, tipo, gravedad,
      ubicacion,
      fallecidos, lesionados, fuente, external_id, raw,
      vehiculos, entidad, direccion, codigo_externo
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
      $9, $10, $11, $12, $13, $14, $15, $16, $17
    )
    ON CONFLICT ON CONSTRAINT accidentes_fuente_external_id_key DO NOTHING
    RETURNING
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
      ingested_at, updated_at,
      vehiculos, entidad, direccion, codigo_externo,
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
    vehiculos,
    entidad,
    direccion,
    codigo_externo,
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
      vehiculos, entidad, direccion, codigo_externo,
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
      vehiculos, entidad, direccion, codigo_externo,
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
      vehiculos, entidad, direccion, codigo_externo,
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

async function countByExternalIds(ids) {
  if (!ids || ids.length === 0) return 0;
  const sql = `
    SELECT COUNT(*)::int AS count
    FROM accidentes
    WHERE fuente = 'SRATMA' AND external_id = ANY($1::bigint[])
  `;
  const { rows } = await pool.query(sql, [ids]);
  return rows[0]?.count ?? 0;
}

async function getStats() {
  const sql = `
    SELECT
      COUNT(*)::int AS total_accidentes,
      COUNT(DISTINCT ubigeo)::int AS total_distritos,
      MAX(ingested_at)::text AS ultima_actualizacion,
      COUNT(*) FILTER (WHERE gravedad = 'Baja')::int AS baja,
      COUNT(*) FILTER (WHERE gravedad = 'Media')::int AS media,
      COUNT(*) FILTER (WHERE gravedad = 'Alta')::int AS alta
    FROM accidentes;
  `;
  const { rows } = await pool.query(sql);
  const r = rows[0];
  return {
    totalAccidentes: r.total_accidentes,
    totalDistritos: r.total_distritos,
    porGravedad: { Baja: r.baja, Media: r.media, Alta: r.alta },
    ultimaActualizacion: r.ultima_actualizacion,
  };
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
  getStats,
  countByExternalIds,
};