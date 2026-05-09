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
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ORDER BY id;
  `;

  const { rows } = await pool.query(query);
  return rows;
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
    RETURNING
      id, fecha, hora, distrito, ubigeo, tipo, gravedad,
      fallecidos, lesionados, fuente, external_id, raw,
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
      ST_Y(ubicacion::geometry) AS lat,
      ST_X(ubicacion::geometry) AS lng
    FROM accidentes
    ${where}
    ORDER BY id;
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

async function findBaseDataset() {
  return findAll();
}

module.exports = {
  findAll,
  insertOne,
  findFiltered,
  findBaseDataset,
};