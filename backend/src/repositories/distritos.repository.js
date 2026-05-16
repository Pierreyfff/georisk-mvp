const { pool } = require("../db/pool");

async function list({ search = null, limit = 300, departamento = null, provincia = null } = {}) {
  const values = [];
  const where = [];

  if (search) {
    values.push(`%${String(search).trim().toUpperCase()}%`);
    where.push(`UPPER(distrito) LIKE $${values.length}`);
  }

  if (departamento) {
    values.push(String(departamento).trim());
    where.push(`departamento = $${values.length}`);
  }

  if (provincia) {
    values.push(String(provincia).trim());
    where.push(`provincia = $${values.length}`);
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

async function getDistritos(departamento, provincia) {
  const values = [];
  const where = [];

  if (departamento) {
    values.push(String(departamento).trim());
    where.push(`departamento = $${values.length}`);
  }

  if (provincia) {
    values.push(String(provincia).trim());
    where.push(`provincia = $${values.length}`);
  }

  const sql = `
    SELECT ubigeo, distrito, provincia, departamento
    FROM distritos
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY distrito;
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}

async function getDepartamentos() {
  const sql = `
    SELECT DISTINCT departamento
    FROM distritos
    WHERE departamento IS NOT NULL
    ORDER BY departamento;
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

async function getProvincias(departamento) {
  const sql = `
    SELECT DISTINCT provincia
    FROM distritos
    WHERE departamento = $1 AND provincia IS NOT NULL
    ORDER BY provincia;
  `;
  const { rows } = await pool.query(sql, [String(departamento).trim()]);
  return rows;
}

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

async function getGeoJsonByDepartamento(departamento) {
  const sql = `
    SELECT
      ubigeo,
      distrito,
      provincia,
      departamento,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM distritos
    WHERE departamento = $1;
  `;

  const { rows } = await pool.query(sql, [String(departamento).trim()]);

  const features = rows.map(r => ({
    type: "Feature",
    properties: {
      ubigeo: r.ubigeo,
      distrito: r.distrito,
      provincia: r.provincia,
      departamento: r.departamento,
    },
    geometry: r.geometry,
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

async function getGeoJsonByProvincia(provincia, departamento) {
  const sql = `
    SELECT
      ubigeo,
      distrito,
      provincia,
      departamento,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM distritos
    WHERE provincia = $1 AND departamento = $2;
  `;

  const { rows } = await pool.query(sql, [String(provincia).trim(), String(departamento).trim()]);

  const features = rows.map(r => ({
    type: "Feature",
    properties: {
      ubigeo: r.ubigeo,
      distrito: r.distrito,
      provincia: r.provincia,
      departamento: r.departamento,
    },
    geometry: r.geometry,
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

module.exports = {
  list,
  getDepartamentos,
  getProvincias,
  getDistritos,
  getGeoJsonByUbigeo,
  getGeoJsonByDepartamento,
  getGeoJsonByProvincia,
};