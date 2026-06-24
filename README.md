# GeoRisk Analytics

Sistema de monitoreo y visualización en tiempo real de accidentes de tránsito en Perú. Ingiesta datos automáticamente desde la API pública de SRATMA (MTC) mediante ingeniería inversa de sus endpoints, los almacena con georreferenciación (PostGIS) y los despliega en un mapa interactivo con Leaflet. Incluye conciliación en memoria para asegurar que solo se muestren accidentes activos según la fuente oficial.

> **Propósito:** Proporcionar una plataforma de observabilidad de siniestros viales que permita a ciudadanos, investigadores y entidades gubernamentales visualizar la siniestralidad en Perú con datos actualizados, análisis por ubicación y severidad, y trazabilidad de la ingesta de datos.

---

## Stack Tecnológico

| Capa | Tecnologías |
|------|------------|
| **Frontend** | HTML5+CSS3 vanilla, Leaflet 1.9.4 (CDN), WebGL2 (shaders animados), Inter Font |
| **Backend** | Node.js 20 + Express 5, node-postgres, helmet, express-rate-limit |
| **Base de datos** | PostgreSQL 16 + PostGIS 3.4 (puntos, polígonos, índices GIST) |
| **Infraestructura** | Docker Compose (3 servicios), nginx:alpine (proxy reverso + security headers) |

---

## Cómo obtenemos los datos (Ingeniería Inversa SRATMA)

El sistema se conecta a la API pública de SRATMA del MTC (`https://sratma.mtc.gob.pe/wssratma/api/Mapa`). Los endpoints fueron descubiertos mediante **ingeniería inversa** analizando el tráfico de red (DevTools → Network) de la aplicación web oficial de SRATMA:

1. **`/WSAbrirMapa`** — lista los IDs de accidentes activos en el mapa en un rango de fechas. Responde con un array de features `{id_accidente, fecha, codigo}`.
2. **`/WSBuscarAccidente`** — dado un ID, devuelve el detalle completo (ubicación, tipo, gravedad, vehículos, entidad, dirección, etc.) en formato JSON.

### Flujo de ingeniería inversa

```
SRATMA Web App (frontend MTC)
        │
        ▼  (analizar con DevTools → Network → XHR/Fetch)
Endpoints descubiertos:
  POST /WSAbrirMapa         → lista IDs activos por fecha
  POST /WSBuscarAccidente   → detalle completo por ID
        │
        ▼  (replicar en backend)
sratma.client.js
  - listarAccidenteMapa(ipInput)     → llama a /WSAbrirMapa
  - listarAccidenteMapaInformacion(id) → llama a /WSBuscarAccidente
  - retry exponencial (3 intentos con backoff de 1s)
```

### Motor de ingesta (`sratmaIngest.job.js`)

Tres modos de operación:

| Modo | Disparo | Qué hace |
|------|---------|----------|
| **Backfill inicial** | Al arrancar si DB vacía | Retrocede 90 días e ingiere día por día (máx 2000/día) |
| **Tick** | Cada 15s | Consulta IDs nuevos desde el último `external_id` conocido (máx 200/tick) |
| **Backfill periódico** | Cada 6h | Repasa los últimos 3 días para capturar IDs omitidos en el tick |

### Flujo completo de datos

```
SRATMA API (fuente oficial)
    │
    ▼
sratma.client.js  (cliente HTTP con retry)
    │
    ├────► sratmaCache.js  (Set en memoria: IDs activos)
    │         │
    │         ├── usado por /api/accidentes/stats → reconcile.sratmaListed
    │         └── usado por /api/accidentes/filtrados?verified=true → filtra DB
    │
    └────► processBatch()  (extrae detalle, valida, inserta en DB)
              │
              ├── OK      → INSERT en accidentes (fuente='SRATMA')
              ├── invalid → no tiene lat/lng/fecha/hora → se descarta, se loguea
              └── error   → fallo de red/API → se reintenta en el próximo tick
                    │
                    ▼
              PostgreSQL + PostGIS
                    │
                    ▼
              API REST (/api/accidentes/*)
                    │
                    ├── /stats          → landing page (contador)
                    ├── /filtrados      → mapa Leaflet (markers + KPIs)
                    └── /stream         → SSE en tiempo real
```

### Ciclo de reconciliación (SRATMA Cache)

```
Cada tick:
  1. listarAccidenteMapa() → obtiene 95 IDs actuales de SRATMA
  2. sratmaCache.update(ids) → cache en memoria = 95
  3. Filtrar IDs nuevos (id > last_external_id_db)
  4. Procesar batch (fetch detalle → validar → insertar)
  5. Fin del tick

En cualquier momento:
  /api/accidentes/stats devuelve:
    reconcile.sratmaListed    = 95  (IDs en cache = fuente oficial)
    reconcile.verifiedDbTotal = 88  (registros en BD que coinciden con cache)
    reconcile.dbTotal         = ?   (total de registros en BD, todas las fuentes)
    reconcile.verified        = true/false  (sratmaListed === verifiedDbTotal)

  El gap entre sratmaListed y verifiedDbTotal son IDs que SRATMA
  lista pero no tienen coordenadas válidas (lat/lng) para ser insertados en BD.
```

---

## Estructura del Proyecto

```
georisk/
├── backend/
│   ├── src/
│   │   ├── server.js                 # Entry point: inicia Express, jobs, simulator
│   │   ├── app.js                    # Express app: rutas, helmet, CORS, rate-limit
│   │   ├── controllers/              # Manejadores de cada ruta
│   │   ├── db/                       # Pool de conexiones PostgreSQL
│   │   ├── integrations/
│   │   │   ├── sratma.client.js      # Cliente HTTP para SRATMA con retry exponencial
│   │   │   └── sratmaCache.js        # Cache en memoria de IDs activos de SRATMA
│   │   ├── jobs/
│   │   │   └── sratmaIngest.job.js   # Motor de ingesta: backfill, tick, periódico
│   │   ├── reactive/                 # EventBus (pub/sub) + simulador de accidentes
│   │   ├── repositories/             # Consultas SQL para accidentes, distritos, ingest_runs
│   │   ├── routes/                   # Definiciones de rutas REST + SSE
│   │   ├── scripts/                  # Script CLI para importar GeoJSON de distritos
│   │   └── services/                 # Lógica de negocio: validación, KPIs, filtros, reconciliación
│   ├── package.json
│   └── Dockerfile
│
├── frontend/
│   ├── index.html                    # Landing page con WebGL background
│   ├── map.html                      # Mapa Leaflet con controles colapsables y KPIs
│   ├── landing.js                    # Shader WebGL2 + animaciones
│   ├── app.js                        # Lógica del mapa: markers, SSE, filtros, drag táctil
│   ├── config.js                     # Config para deploy (SSE_BASE editable)
│   ├── vercel.json                   # Rewrites /api/* para deploy en Vercel
│   ├── nginx.conf                    # Proxy reverso + security headers
│   ├── images/
│   │   └── map2-removebg-preview.*   # PNG + WebP (6.9KB, 80% más pequeño)
│   ├── data/
│   │   └── peru_distrital_simple.geojson
│   └── vendor/
│       └── osmtogeojson.js
│
├── database/
│   └── init.sql                      # Schema PostGIS con índices, triggers, constraints
│
├── docker-compose.yml                # Orquestación de 3 servicios
└── .gitignore
```

---

## Endpoints de la API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check (DB + server) |
| `GET` | `/ingest-status` | Estadísticas de ingesta en vivo |
| `GET` | `/api/accidentes/stats` | Estadísticas de accidentes (conteo verificado vs SRATMA, KPIs, reconciliación) |
| `GET` | `/api/accidentes/reconcile` | Estado de reconciliación SRATMA (DB total, listados, verificados) |
| `GET` | `/api/accidentes/filtrados?distrito=&gravedad=&verified=true` | Accidentes filtrados (sin campo raw) |
| `GET` | `/api/accidentes/export?distrito=&gravedad=` | Exportar CSV de la vista actual |
| `POST` | `/api/accidentes` | Crear accidente manualmente |
| `GET` | `/api/accidentes/:id/audit` | Auditoría por ID interno |
| `GET` | `/api/accidentes/external/:fuente/:external_id/audit` | Auditoría por fuente + ID externo |
| `GET` | `/api/distritos` | Lista de distritos (con búsqueda y límite) |
| `GET` | `/api/distritos/:ubigeo/geojson` | GeoJSON del polígono de un distrito |
| `GET` | `/api/distritos/geometria/agregada?departamento=&provincia=` | Geometría agregada por depto/provincia |
| `GET` | `/api/stream/accidentes` | SSE streaming en tiempo real |
| `GET` | `/api/ingest-runs` | Historial de ejecuciones de ingesta |
| `GET` | `/api/ingest-runs/:id` | Detalle de una ejecución |

---

## Inicio Rápido (Local)

### Requisitos
- Docker Desktop / Docker Compose

### Pasos

```bash
# 1. Clonar
git clone https://github.com/Pierreyfff/georisk-mvp.git
cd georisk

# 2. Construir y levantar
docker compose build --no-cache
docker compose up -d

# 3. Importar distritos (polígonos) a PostGIS
docker compose exec -T backend mkdir -p /tmp/data
docker cp frontend/data/peru_distrital_simple.geojson georisk-backend:/tmp/data/
docker compose exec backend node src/scripts/import_distritos_geojson.js /tmp/data/peru_distrital_simple.geojson

# 4. Verificar ingesta
curl http://localhost:3000/ingest-status

# 5. Abrir navegador
# Frontend: http://localhost:8080
# API:      http://localhost:3000
```

### Puertos

| Puerto | Servicio | Descripción |
|--------|----------|-------------|
| `5432` | PostGIS | Base de datos espacial |
| `3000` | Backend API | Endpoints REST + SSE |
| `8080` | Frontend | Mapa Leaflet + Landing Page |

---

## Despliegue (Producción)

### Opción recomendada: Vercel (frontend) + Render (backend + DB)

**Frontend (Vercel):**
1. Importar repositorio → Root Directory: `frontend/` → Framework: Other
2. `vercel.json` ya incluido — redirige `/api/*` al backend en Render
3. Para que SSE funcione, editar `frontend/config.js` y apuntar `SSE_BASE` a la URL directa de Render
4. Si SSE no es crítico, el frontend usa polling cada 30s como fallback

**Backend (Render):**
1. Crear Web Service desde el Dockerfile en `backend/`
2. Añadir variables de entorno: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `SRATMA_INGEST=on`, `CORS_ORIGIN=https://tudominio.vercel.app`
3. Crear base de datos PostgreSQL con PostGIS (Render Managed PostgreSQL o Neon)

**Nota:** Vercel no soporta Docker ni conexiones SSE persistentes (timeout 10s en plan Hobby). Las requests regulares funcionan via rewrites; SSE necesita apuntar directo a Render o usar el polling fallback.

---

## Funcionalidades Clave

### Mapa interactivo
- Markers SVG coloreados por severidad (verde=baja, amarillo=media, rojo=alta)
- Popups con datos completos (fecha, hora, ubicación, tipo, gravedad, vehículos)
- Filtros geográficos por departamento/provincia/distrito con autocompletado seguro (DOM, sin innerHTML)
- Renderizado de polígonos exactos desde PostGIS al seleccionar un distrito
- KPIs en tiempo real: total, por gravedad, promedio
- Tema claro/oscuro (persistido en localStorage)

### Móvil responsive
- Card de filtros colapsable (botón −/+)
- Drag con soporte táctil (touchstart/touchmove/touchend)
- KPIs responsivos, layout adaptativo a 768px y 640px
- Imagen del mapa en WebP (6.9KB) con fallback PNG via `<picture>`

### Seguridad aplicada
- Helmet + express-rate-limit (120 req/min) en backend
- CORS restringido al origen del frontend
- Security headers en nginx (X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Campo `raw` eliminado de respuestas API (contenía datos sensibles de SRATMA)
- Auditoría sin exponer `raw`
- XSS corregido: sugerencias de búsqueda usan `textContent` + `createTextNode`, no `innerHTML`
- Error handler sanitizado (no filtra detalles internos)

### SRATMA Cache & Reconciliación
- `sratmaCache.js`: Set en memoria con los IDs activos del listado SRATMA, actualizado cada tick
- `/api/accidentes/stats` retorna:
  - `totalAccidentes` = total de registros en BD
  - `reconcile.sratmaListed` = IDs activos según SRATMA (fuente oficial)
  - `reconcile.verifiedDbTotal` = registros en BD que coinciden con el cache SRATMA
  - `reconcile.dbTotal` = total de registros en BD
  - `reconcile.verified` = `sratmaListed === verifiedDbTotal` (true = todo en orden)
- Mapa usa `?verified=true` para mostrar solo accidentes SRATMA-activos
- Landing Page muestra `reconcile.sratmaListed` (total oficial)
- Tanto landing como mapa son consistentes: el gap entre `sratmaListed` y `verifiedDbTotal` son IDs listados por SRATMA sin coordenadas válidas

---

## Base de Datos (PostGIS)

### Tabla `accidentes`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `SERIAL PK` | Identificador interno autoincremental |
| `fecha` | `DATE NOT NULL` | Fecha del accidente (de SRATMA) |
| `hora` | `TIME NOT NULL` | Hora del accidente |
| `distrito` | `TEXT NOT NULL` | Nombre del distrito donde ocurrió |
| `ubigeo` | `TEXT NULL CHECK ~'^\d{6}$'` | Código UBIGEO de 6 dígitos |
| `tipo` | `TEXT NOT NULL` | Tipo/clase de accidente (vuelco, choque, atropello...) |
| `gravedad` | `TEXT NOT NULL CHECK IN ('Baja','Media','Alta')` | Severidad según víctimas |
| `fallecidos` | `INTEGER NULL` | Número de fallecidos |
| `lesionados` | `INTEGER NULL` | Número de lesionados |
| `fuente` | `TEXT NULL` | Fuente de datos (ej. 'SRATMA') |
| `external_id` | `BIGINT NULL` | ID del accidente en la fuente externa |
| `raw` | `JSONB NULL` | Payload completo original (solo interno, no se expone en API) |
| `ubicacion` | `GEOGRAPHY(POINT,4326) NOT NULL` | Coordenadas geográficas (PostGIS) |
| `lat` | `DOUBLE PRECISION GENERATED` | Latitud generada automáticamente desde `ubicacion` |
| `lng` | `DOUBLE PRECISION GENERATED` | Longitud generada automáticamente desde `ubicacion` |
| `vehiculos` | `INTEGER NULL` | Número de vehículos involucrados |
| `entidad` | `TEXT NULL` | Entidad que reportó (PNP, Serenazgo, Concesionaria...) |
| `direccion` | `TEXT NULL` | Dirección o referencia del lugar |
| `codigo_externo` | `TEXT NULL` | Código de expediente externo |
| `ingested_at` | `TIMESTAMPTZ DEFAULT now()` | Momento de ingesta en el sistema |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Última modificación (actualizado por trigger) |

**Constraints:**
- `UNIQUE(fuente, external_id)` — garantiza idempotencia (PostgreSQL permite múltiples NULLs)
- `CHECK(ubigeo ~ '^\d{6}$')` — formato UBIGEO válido
- `lat`/`lng` son columnas `GENERATED ALWAYS AS (ST_Y(ubicacion::geometry))` — no requieren inserción manual

**Índices:**
- `GIST (ubicacion)` — búsquedas espaciales
- `BTREE (fecha DESC, hora DESC)` — ordenamiento temporal
- `BTREE (ubigeo)` — filtros por ubicación administrativa
- `BTREE (gravedad)` — filtros por severidad
- `BTREE (fuente)` — filtros por fuente de datos

### Tabla `distritos`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `ubigeo` | `TEXT PK CHECK ~'^\d{6}$'` | Código UBIGEO de 6 dígitos |
| `departamento` | `TEXT NULL` | Nombre del departamento |
| `provincia` | `TEXT NULL` | Nombre de la provincia |
| `distrito` | `TEXT NULL` | Nombre del distrito |
| `geom` | `GEOMETRY(MultiPolygon,4326) NOT NULL` | Polígono geográfico |

**Índices:**
- `GIST (geom)` — búsquedas espaciales
- `BTREE (departamento, provincia, distrito)` — búsquedas administrativas

### Tabla `ingest_runs`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `SERIAL PK` | Identificador interno |
| `fuente` | `TEXT NOT NULL` | Fuente procesada (ej. 'SRATMA') |
| `mode` | `TEXT NOT NULL` | Modo: 'backfill', 'tick', 'periodic_backfill' |
| `started_at` | `TIMESTAMPTZ DEFAULT now()` | Inicio de la ejecución |
| `finished_at` | `TIMESTAMPTZ NULL` | Fin de la ejecución |
| `range_from` | `DATE NULL` | Fecha inicial del rango (backfill) |
| `range_to` | `DATE NULL` | Fecha final del rango (backfill) |
| `interval_ms` | `INTEGER NULL` | Intervalo entre ticks (tick) |
| `listed` | `INTEGER NULL` | IDs listados por SRATMA en esta ejecución |
| `batch` | `INTEGER NULL` | IDs procesados en este lote |
| `created` | `INTEGER DEFAULT 0` | Registros creados exitosamente |
| `duplicates` | `INTEGER DEFAULT 0` | IDs ya existentes en DB |
| `invalid` | `INTEGER DEFAULT 0` | IDs con datos inválidos (sin coordenadas, fecha, etc.) |
| `errors` | `INTEGER DEFAULT 0` | Errores de red/API |
| `notes` | `JSONB NULL` | Notas adicionales (ej. IDs restantes) |

**Propósito:** Auditoría completa del pipeline de ingesta. Permite rastrear cuántos accidentes de SRATMA se pierden por datos inválidos y diagnosticar problemas de conectividad.

---

## Variables de Entorno

### Backend (`.env` / `docker-compose.yml`)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PGHOST` | `db` | Host de PostgreSQL |
| `PGPASSWORD` | `georisk_pass` | Contraseña de PostgreSQL |
| `SRATMA_INGEST` | `on` | Activa/desactiva la ingesta automática |
| `SRATMA_INTERVAL_MS` | `15000` | Intervalo entre ticks (ms) |
| `SRATMA_MAX_PER_TICK` | `200` | Máximo de accidentes por tick |
| `SRATMA_CONCURRENCY` | `10` | Concurrencia en llamadas API |
| `CORS_ORIGIN` | `http://localhost:8080` | Origen permitido para CORS |

Ver `docker-compose.yml` para la lista completa de variables de configuración de ingesta.

---

## Evaluación: Dashboard de Visualizaciones

### Opción recomendada: Gráficos integrados en el frontend

Se puede añadir una página de dashboard independiente (ruta `/dashboard`) usando **Chart.js** (CDN, ~60KB gzip) sin depender de servicios externos.

**Ventajas:**
- Misma paleta de colores y estilo que el mapa y landing (CSS variables `--gold`, `--bg-base`, etc.)
- Datos en tiempo real vía SSE
- Sin dependencias externas (no necesita Google Sheets ni Looker Studio)
- API REST ya expone todos los datos necesarios

**Implementación sugerida (nuevos archivos):**
- `frontend/dashboard.html` — estructura con header y contenedores de gráficos
- `frontend/dashboard.js` — lógica con Chart.js, filtros y conexión SSE

**Gráficos viables:**

| Visualización | Fuente de datos |
|---------------|-----------------|
| Tarjeta total + gap SRATMA vs BD | `GET /api/accidentes/stats` → `reconcile.sratmaListed, verifiedDbTotal` |
| Pastel por gravedad | `GET /api/accidentes/stats` → `porGravedad` |
| Barras por tipo de accidente | `GET /api/accidentes/filtrados?verified=true` → agrupar `tipo` |
| Tendencia temporal | `GET /api/accidentes/filtrados?verified=true` → agrupar por `fecha` |
| Top 10 distritos | `GET /api/accidentes/filtrados?verified=true` → agrupar por `distrito` |
| Heatmap geográfico (Leaflet + heatmap layer) | `GET /api/accidentes/filtrados?verified=true` → `lat, lng` |

**Filtros:** Selector de departamento/provincia/distrito (reutilizar lógica de `map.html`), rango de fechas, gravedad. Todos conectados a `GET /api/accidentes/filtrados?distrito=&gravedad=&verified=true`.

**Navegación:** Botón "Dashboard" en el header de `map.html`, junto al botón de tema. Se puede agregar también desde `index.html` como enlace opcional.

**Ruta de acceso:** `frontend/vercel.json` ya tiene rewrites para servir archivos estáticos, así que `/dashboard` → `dashboard.html` funciona sin configuración adicional.

### Opción alternativa: Google Sheets + Looker Studio

1. Crear un Google Apps Script que consuma `/api/accidentes/filtrados?verified=true` y escriba en una Sheet
2. Conectar Looker Studio a la Sheet como fuente de datos
3. Programar actualización cada 15-30 min

**Desventajas:** No es tiempo real, requiere mantenimiento del script, expiración de tokens, no se integra visualmente con la app.

---
