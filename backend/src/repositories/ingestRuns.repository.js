const { pool } = require("../db/pool");

async function createRun({
  fuente,
  mode,
  range_from = null,
  range_to = null,
  interval_ms = null,
  listed = null,
  batch = null,
  notes = null,
} = {}) {
  const sql = `
    INSERT INTO ingest_runs (
      fuente, mode, range_from, range_to, interval_ms, listed, batch, notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id, fuente, mode, started_at, range_from, range_to;
  `;
  const values = [
    fuente,
    mode,
    range_from,
    range_to,
    interval_ms,
    listed,
    batch,
    notes ? JSON.stringify(notes) : null,
  ];
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function finishRun({
  id,
  finished_at = new Date(),
  created = 0,
  duplicates = 0,
  invalid = 0,
  errors = 0,
  listed = null,
  batch = null,
  notes = null,
} = {}) {
  const sql = `
    UPDATE ingest_runs
    SET
      finished_at = $2,
      created = $3,
      duplicates = $4,
      invalid = $5,
      errors = $6,
      listed = COALESCE($7, listed),
      batch = COALESCE($8, batch),
      notes = COALESCE($9, notes)
    WHERE id = $1
    RETURNING id, fuente, mode, started_at, finished_at, created, duplicates, invalid, errors;
  `;
  const values = [
    Number(id),
    finished_at,
    Number(created),
    Number(duplicates),
    Number(invalid),
    Number(errors),
    listed == null ? null : Number(listed),
    batch == null ? null : Number(batch),
    notes ? JSON.stringify(notes) : null,
  ];
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

module.exports = {
  createRun,
  finishRun,
};