-- PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla accidentes (alineada con backend)
CREATE TABLE IF NOT EXISTS accidentes (
  id           SERIAL PRIMARY KEY,
  fecha        DATE NOT NULL,
  hora         TIME NOT NULL,
  distrito     TEXT NOT NULL,
  ubigeo       TEXT NULL,
  tipo         TEXT NOT NULL,
  gravedad     TEXT NOT NULL CHECK (gravedad IN ('Baja', 'Media', 'Alta')),
  fallecidos   INTEGER NULL,
  lesionados   INTEGER NULL,
  fuente       TEXT NULL,
  external_id  BIGINT NULL,
  raw          JSONB NULL,
  ubicacion    GEOGRAPHY(POINT, 4326) NOT NULL,
  lat          DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(ubicacion::geometry)) STORED,
  lng          DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(ubicacion::geometry)) STORED,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ubigeo válido si existe
ALTER TABLE accidentes
  ADD CONSTRAINT accidentes_ubigeo_format
  CHECK (ubigeo IS NULL OR ubigeo ~ '^\d{6}$');

-- Dedupe robusto para SRATMA (y cualquier fuente):
-- Postgres permite múltiples NULLs en UNIQUE, así que no rompe cuando external_id es NULL.
ALTER TABLE accidentes
  ADD CONSTRAINT accidentes_fuente_external_id_key UNIQUE (fuente, external_id);

-- Índices
CREATE INDEX IF NOT EXISTS idx_accidentes_ubicacion
ON accidentes
USING GIST (ubicacion);

CREATE INDEX IF NOT EXISTS idx_accidentes_fecha_hora
ON accidentes (fecha DESC, hora DESC);

CREATE INDEX IF NOT EXISTS idx_accidentes_ubigeo
ON accidentes (ubigeo);

CREATE INDEX IF NOT EXISTS idx_accidentes_gravedad
ON accidentes (gravedad);

CREATE INDEX IF NOT EXISTS idx_accidentes_fuente
ON accidentes (fuente);

-- =========================
-- Tabla distritos (para filtros y geojson)
-- =========================
CREATE TABLE IF NOT EXISTS distritos (
  ubigeo       TEXT PRIMARY KEY,
  departamento TEXT,
  provincia    TEXT,
  distrito     TEXT,
  geom         geometry(MultiPolygon, 4326) NOT NULL
);

-- Ubigeo válido (6 dígitos)
ALTER TABLE distritos
  ADD CONSTRAINT distritos_ubigeo_format
  CHECK (ubigeo ~ '^\d{6}$');

-- Índice espacial
CREATE INDEX IF NOT EXISTS idx_distritos_geom
ON distritos
USING GIST (geom);

-- Índices para búsquedas
CREATE INDEX IF NOT EXISTS idx_distritos_distrito
ON distritos (distrito);

CREATE INDEX IF NOT EXISTS idx_distritos_departamento
ON distritos (departamento);

CREATE INDEX IF NOT EXISTS idx_distritos_provincia
ON distritos (provincia);