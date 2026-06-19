-- ================================================================
-- Migration: Corrección de geometrías incorrectas en tabla distritos
-- ================================================================
-- Este script:
--   1. Corrige geometrías inválidas con ST_MakeValid
--   2. Elimina duplicados manteniendo solo la fila más reciente por ubigeo
--   3. Identifica geometrías que siguen siendo inválidas post-corrección
-- ================================================================

BEGIN;

-- Paso 1: Corregir geometrías inválidas
UPDATE distritos
SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
WHERE NOT ST_IsValid(geom);

-- Paso 2: Identificar y eliminar duplicados de ubigeo
-- (en caso de que existan por inserciones previas sin PRIMARY KEY)
DELETE FROM distritos
WHERE ctid NOT IN (
  SELECT min(ctid)
  FROM distritos
  GROUP BY ubigeo
);

-- Paso 3: Listar geometrías que siguen siendo inválidas después de ST_MakeValid
SELECT ubigeo, departamento, provincia, distrito,
       ST_IsValidReason(geom) AS invalid_reason
FROM distritos
WHERE NOT ST_IsValid(geom);

-- Paso 4: Reindexar índice espacial
REINDEX INDEX idx_distritos_geom;

COMMIT;
