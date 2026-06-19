# Plan de Mejora — Ingesta SRATMA/ONSV

## Diagnóstico Inicial

### Fuente de datos
- **API**: `https://sratma.mtc.gob.pe/wssratma/api/Mapa`
- **Propietario**: MTC — SRATMA (Sistema de Registro de Accidentes de Tránsito)
- **Relación con ONSV**: ONSV consume datos de SRATMA. Nuestra API SRATMA es la misma fuente que alimenta al Observatorio. **Sí es ingeniería inversa legítima** sobre endpoints públicos.
- **Cobertura actual**: 103 accidentes listados (IDs 20858–21104). Nuestra DB solo tiene 10 (IDs 21088–21104).

### Deficiencias encontradas

| # | Deficiencia | Gravedad | Detalle |
|---|------------|----------|---------|
| 1 | Backfill no funciona con DB vacía | **CRÍTICA** | `backfill_skip_no_last_date` cuando `getLastFechaByFuente` retorna null — nunca importa datos históricos |
| 2 | Tick solo procesa últimos N IDs | **CRÍTICA** | `ids.slice(-maxPerTick)` con max=10 ignora IDs anteriores — jamás se recuperan los 93 faltantes |
| 3 | Sin retry en llamadas API | **ALTA** | Si SRATMA falla, el error se pierde sin reintento |
| 4 | Campos mapeados incompletos | **MEDIA** | `nro_vehiculos`, `entidad`, `fuente_url`, `direccion`, `cod_accidente_transito` no se almacenan |
| 5 | Sin monitoreo de ingesta | **MEDIA** | No hay endpoint que exponga estado de la ingesta (último tick, errores, lag) |
| 6 | Backfill lento (día por día) | **BAJA** | Procesa 1 día a la vez, 2000 IDs/día, pero para fresh start es adecuado |
| 7 | Sin logging estructurado de errores | **BAJA** | Errores se loggean pero no se persisten para diagnóstico |

---

## Fases de Implementación

### Fase 1 — Fix Backfill para DB vacía
**Objetivo**: Cuando la DB está vacía, el backfill debe arrancar desde una fecha por defecto (90 días atrás) en vez de saltarse.

**Archivos**: `backend/src/jobs/sratmaIngest.job.js`

**Cambios**:
- Config default `SRATMA_BACKFILL_DEFAULT_DAYS=90`
- Cuando `lastFecha` es null, usar `new Date() - 90 days` como `lastFecha`
- Ajustar `backfillOnce()` para que no se skipee

### Fase 2 — Fix Tick para procesar IDs no vistos
**Objetivo**: En vez de tomar los últimos N IDs, calcular cuáles NO tenemos y procesarlos.

**Archivos**: `backend/src/jobs/sratmaIngest.job.js`

**Cambios**:
- En tick, después de listar IDs, filtrar solo los > `last_external_id_db`
- Limitar por `SRATMA_MAX_PER_TICK` pero sobre los unseen, no sobre el final del array
- Si hay backlog grande, se procesa en varios ticks hasta ponerse al día

### Fase 3 — Agregar retry exponencial en API calls
**Objetivo**: Si SRATMA responde con error, reintentar hasta 3 veces con backoff.

**Archivos**: `backend/src/integrations/sratma.client.js`

**Cambios**:
- Wrapper `httpGetJsonWithRetry` que reintenta con delay exponencial (1s, 3s, 7s)
- Log de cada intento fallido

### Fase 4 — Agregar campos faltantes al schema
**Objetivo**: Almacenar `nro_vehiculos`, `entidad`, `direccion`, `codigo_externo` como columnas queryables.

**Archivos**: 
- `database/init.sql`
- `backend/src/repositories/accidentes.repository.js`
- `backend/src/services/accidentes.service.js`
- `backend/src/jobs/sratmaIngest.job.js`

**Cambios**:
- Agregar columnas a `accidentes`:
  - `vehiculos INTEGER NULL`
  - `entidad TEXT NULL`
  - `direccion TEXT NULL`
  - `codigo_externo TEXT NULL`
- Mapear desde `mapDetalleToAccidente`
- Actualizar INSERT y SELECT

### Fase 5 — Agregar endpoints de monitoreo
**Objetivo**: Exponer estado de la ingesta para verificación.

**Archivos**:
- `backend/src/app.js`
- `backend/src/services/accidentes.service.js`

**Cambios**:
- Endpoint `GET /ingest-status` que retorna:
  - Último tick
  - IDs en SRATMA vs IDs en DB
  - Últimos errores
  - Lag (# de IDs pendientes)

### Fase 6 — Rebuild & up sin cache
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### Fase 7 — Verificación final
- Confirmar que backfill histórico corre
- Confirmar que todos los IDs se importan
- Confirmar idempotencia (re-ejecución no duplica)
- Confirmar persistencia (detener/arrancar no pierde datos)
