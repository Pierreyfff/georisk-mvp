-- Habilita PostGIS (en muchas imágenes ya está, pero es buena práctica)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla principal
CREATE TABLE IF NOT EXISTS accidentes (
  id           SERIAL PRIMARY KEY,
  fecha        DATE NOT NULL,
  hora         TIME NOT NULL,
  distrito     TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  gravedad     TEXT NOT NULL CHECK (gravedad IN ('Baja', 'Media', 'Alta')),

  -- Punto geográfico: (lng, lat) en WGS84
  ubicacion    GEOGRAPHY(POINT, 4326) NOT NULL,

  -- Campos derivados opcionales para facilitar el frontend (se pueden calcular en query también)
  lat          DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(ubicacion::geometry)) STORED,
  lng          DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(ubicacion::geometry)) STORED
);

-- Índice espacial para consultas geográficas eficientes
CREATE INDEX IF NOT EXISTS idx_accidentes_ubicacion
ON accidentes
USING GIST (ubicacion);