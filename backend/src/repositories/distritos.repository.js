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
      ST_AsGeoJSON(ST_MakeValid(geom))::json AS geometry
    FROM distritos
    WHERE ubigeo = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [String(ubigeo).trim()]);
  return rows[0] || null;
}

async function getAggregatedGeoJson({ departamento, provincia }) {
  const values = [];
  const conditions = [];
  if (departamento) {
    values.push(String(departamento).trim());
    conditions.push(`departamento = $${values.length}`);
  }
  if (provincia) {
    values.push(String(provincia).trim());
    conditions.push(`provincia = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const groupBy = provincia
    ? "GROUP BY departamento, provincia"
    : "GROUP BY departamento";

  const sql = `
    SELECT
      departamento${provincia ? ", provincia" : ""},
      ST_AsGeoJSON(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Union(
              ST_MakeValid(geom)
            )
          ),
          3
        )
      )::json AS geometry
    FROM distritos
    ${where}
    ${groupBy}
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

module.exports = { list, getGeoJsonByUbigeo, getAggregatedGeoJson };