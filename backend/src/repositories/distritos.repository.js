const { pool } = require("../db/pool");

async function list({ search = null, limit = 300 } = {}) {
  const values = [];
  const where = [];

  if (search) {
    values.push(`%${String(search).trim().toUpperCase()}%`);
    where.push(`UPPER(distrito) LIKE $${values.length}`);
  }

  values.push(Math.min(Number(limit) || 300, 2000));
  const limitParam = `$${values.length}`;

  const sql = `
    SELECT ubigeo, distrito, provincia, departamento
    FROM distritos
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY departamento, provincia, distrito
    LIMIT ${limitParam};
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}

/* =========================
   🔥 NUEVO: GeoJSON por ubigeo
   ========================= */
async function getGeoJsonByUbigeo(ubigeo) {
  const sql = `
    SELECT
      ubigeo,
      distrito,
      provincia,
      departamento,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM distritos
    WHERE ubigeo = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [String(ubigeo).trim()]);
  return rows[0] || null;
}

module.exports = { list, getGeoJsonByUbigeo };