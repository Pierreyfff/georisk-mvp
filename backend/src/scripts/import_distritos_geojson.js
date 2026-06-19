const fs = require("fs");
const path = require("path");
const { pool } = require("../db/pool");

function isValidUbigeo(u) {
  return typeof u === "string" && /^\d{6}$/.test(u);
}

async function main() {
  const geojsonPath =
    process.argv[2] ||
    path.resolve(__dirname, "../../../frontend/data/peru_distrital_simple.geojson");

  const raw = fs.readFileSync(geojsonPath, "utf-8");
  const fc = JSON.parse(raw);

  if (!fc.features || !Array.isArray(fc.features)) {
    throw new Error("GeoJSON inválido: no contiene features[]");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertSql = `
      INSERT INTO distritos (ubigeo, departamento, provincia, distrito, geom)
      VALUES (
        $1, $2, $3, $4,
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)
            ),
            3
          )
        )
      )
      ON CONFLICT (ubigeo) DO UPDATE SET
        departamento = EXCLUDED.departamento,
        provincia = EXCLUDED.provincia,
        distrito = EXCLUDED.distrito,
        geom = EXCLUDED.geom;
    `;

    const validateSql = `
      SELECT ST_IsValid(
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
            ),
            3
          )
        )
      ) AS valid,
      ST_IsValidReason(
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
            ),
            3
          )
        )
      ) AS reason;
    `;

    let ok = 0;
    let skipped = 0;
    let invalidGeoms = 0;
    const UBIGEO_BUFFER = new Map();

    for (const f of fc.features) {
      const p = f?.properties || {};
      const ubigeo = p.IDDIST != null ? String(p.IDDIST).trim() : null;

      if (!isValidUbigeo(ubigeo)) {
        skipped++;
        continue;
      }

      const geom = f?.geometry;
      if (!geom || !geom.type || !geom.coordinates) {
        skipped++;
        continue;
      }

      const geomJson = JSON.stringify(geom);

      const departamento = p.NOMBDEP != null ? String(p.NOMBDEP).trim() : null;
      const provincia = p.NOMBPROV != null ? String(p.NOMBPROV).trim() : null;
      const distrito = p.NOMBDIST != null ? String(p.NOMBDIST).trim() : null;

      // Validar geometría antes de insertar
      const valResult = await client.query(validateSql, [geomJson]);
      if (!valResult.rows[0].valid) {
        invalidGeoms++;
        console.warn(`Geometría inválida ubigeo=${ubigeo} ${departamento}/${provincia}/${distrito}: ${valResult.rows[0].reason}`);
      }

      // Evitar duplicados de ubigeo en el mismo archivo
      if (UBIGEO_BUFFER.has(ubigeo)) {
        const prev = UBIGEO_BUFFER.get(ubigeo);
        console.warn(`Ubigeo duplicado en GeoJSON: ${ubigeo} ${departamento}/${provincia}/${distrito} (previo: ${prev.departamento}/${prev.provincia}/${prev.distrito})`);
      }
      UBIGEO_BUFFER.set(ubigeo, { departamento, provincia, distrito });

      try {
        await client.query(insertSql, [ubigeo, departamento, provincia, distrito, geomJson]);
        ok++;
      } catch (e) {
        skipped++;
        console.error(`Error insertando ubigeo=${ubigeo} ${departamento}/${provincia}/${distrito}:`, e.message);
      }

      if (ok > 0 && ok % 500 === 0) console.log("Importados OK:", ok, "skipped:", skipped);
    }

    await client.query("COMMIT");
    console.log("Import finalizado. OK:", ok, "skipped:", skipped, "inválidas:", invalidGeoms);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error("ERROR import:", e.message);
  process.exit(1);
});