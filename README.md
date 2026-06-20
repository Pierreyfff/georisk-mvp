# GeoRisk Analytics

Sistema de monitoreo y visualización en tiempo real de accidentes de tránsito en Perú. Ingiesta datos automáticamente desde la API pública de SRATMA (MTC) mediante ingeniería inversa de sus endpoints, los almacena con georreferenciación (PostGIS) y los despliega en un mapa interactivo con Leaflet.

> **Propósito del proyecto:** Proporcionar una plataforma de observabilidad de siniestros viales que permita a ciudadanos, investigadores y entidades gubernamentales visualizar la siniestralidad en Perú con datos actualizados, análisis por ubicación y severidad, y trazabilidad de la ingesta de datos.

---

## Arquitectura General

```
┌──────────────────────────────────────────────────────────────────┐
│                        Docker Compose                            │
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────┐    │
│  │   Frontend    │────>│   Backend    │────>│   PostGIS DB   │   │
│  │  nginx:alpine │     │  node:20     │     │  postgis/post- │   │
│  │   :8080       │     │   :3000      │     │  gis:16-3.4    │   │
│  │   Leaflet     │<────│  Express 5   │<────│   :5432        │   │
│  └──────────────┘     └──────┬────────┘     └────────────────┘   │
│                              │                                   │
│                      ┌───────▼────────┐                          │
│                      │  SRATMA API    │                          │
│                      │  MTC Gob.Pe    │                          │
│                      │  (Externo)     │                          │
│                      └────────────────┘                          │
└──────────────────────────────────────────────────────────────────┘

Flujo de datos:
1. SRATMA Ingest Job (backend) consulta API pública de SRATMA cada 15s
2. Nuevos accidentes se persisten en PostgreSQL con PostGIS
3. Cada inserción dispara un evento en el EventBus interno
4. Frontend recibe eventos via SSE (Server-Sent Events)
5. Usuario visualiza accidentes en mapa Leaflet con filtros geográficos
```

---

## Stack Tecnológico Detallado

### Frontend
| Tecnología | Versión / Detalle | Propósito |
|------------|-------------------|-----------|
| Leaflet | 1.9.4 (CDN) | Mapa interactivo con markers SVG |
| Vanilla JS (ES Modules) | — | Sin framework; lógica de mapa, SSE, animaciones |
| WebGL2 | Shaders personalizados | Fondo animado en landing page (`landing.js`) |
| OpenStreetMap tiles | — | Capa base del mapa |
| Google Fonts | JetBrains Mono | Tipografía monospace |
| nginx | alpine | Servidor estático + proxy reverso |

### Backend
| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| Node.js | 20 (Alpine) | Runtime |
| Express | 5.2.1 | Framework HTTP con manejo async de errores |
| pg (node-postgres) | 8.20.0 | Cliente PostgreSQL nativo |
| cors | 2.8.6 | Middleware CORS |
| dotenv | 17.4.2 | Variables de entorno |

### Base de Datos
| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| PostgreSQL | 16 | Motor relacional |
| PostGIS | 3.4 | Extensiones espaciales (puntos, polígonos, índices geográficos) |

### Infraestructura
| Componente | Detalle |
|------------|---------|
| Docker Compose | 3 servicios orquestados (db, backend, frontend) |
| Volumen Docker | `georisk_db_data` para persistencia de datos |
| Proxy reverso | nginx en frontend enruta `/api/` al backend |

---

## Estructura Completa del Proyecto

```
georisk/
├── backend/                        # API REST + motor de ingesta
│   ├── src/
│   │   ├── server.js               # Entry point: inicia Express, jobs, simulator
│   │   ├── app.js                  # Configura Express, rutas, middleware, CORS
│   │   ├── controllers/
│   │   │   ├── accidentes.controller.js   # CRUD + auditoría de accidentes
│   │   │   └── ingestRuns.controller.js   # Listado de ejecuciones de ingesta
│   │   ├── db/
│   │   │   └── pool.js             # Pool de conexiones a PostgreSQL (singleton)
│   │   ├── integrations/
│   │   │   └── sratma.client.js    # Cliente HTTP para SRATMA con retry exponencial
│   │   ├── jobs/
│   │   │   └── sratmaIngest.job.js # Motor de ingesta: backfill + tick + periódico
│   │   ├── reactive/
│   │   │   ├── eventBus.js         # Pub/sub en memoria para SSE
│   │   │   └── simulator.js        # Generador de accidentes ficticios para testing
│   │   ├── repositories/
│   │   │   ├── accidentes.repository.js  # Consultas SQL para accidentes
│   │   │   ├── distritos.repository.js   # Consultas SQL para distritos
│   │   │   └── ingestRuns.repository.js  # Consultas SQL para ingest_runs
│   │   ├── routes/
│   │   │   ├── accidentes.routes.js      # Definiciones de rutas de accidentes
│   │   │   ├── distritos.routes.js       # Definiciones de rutas de distritos
│   │   │   ├── ingestRuns.routes.js      # Definiciones de rutas de ingesta
│   │   │   └── stream.routes.js          # Endpoint SSE /stream/accidentes
│   │   ├── scripts/
│   │   │   └── import_distritos_geojson.js  # Script CLI para importar GeoJSON
│   │   ├── services/
│   │   │   ├── accidentes.service.js     # Lógica de negocio: validación, KPIs, filtros
│   │   │   └── ingestRuns.service.js     # Wrapper sobre ingest_runs repository
│   │   └── utils/
│   │       └── pool.js             # Limitador de concurrencia async (asyncPool)
│   ├── package.json
│   ├── Dockerfile                  # node:20-alpine, npm ci --omit=dev
│   └── .env                        # Variables locales de desarrollo
│
├── frontend/                       # Aplicación web
│   ├── index.html                  # Landing page con WebGL background
│   ├── map.html                    # Mapa Leaflet con controles y KPIs
│   ├── landing.js                  # Shader WebGL2 + animaciones de contador
│   ├── app.js                      # Lógica del mapa: markers, SSE, filtros, polígonos
│   ├── nginx.conf                  # Configuración de nginx (proxy reverso + SSE)
│   ├── data/
│   │   └── peru_distrital_simple.geojson  # ~1.9MB, polígonos distritales de Perú
│   └── vendor/
│       └── osmtogeojson.js         # Librería minificada (2.5k líneas)
│
├── database/
│   └── init.sql                    # Schema completo con PostGIS, índices, triggers
│
├── docs/
│   └── PLAN_INGESTA.md             # Plan de mejora del sistema de ingesta SRATMA
│
├── frontend/images/
│   └── map2-removebg-preview.*     # PNG + WebP del mapa ilustrativo
├── docker-compose.yml              # Orquestación de 3 servicios
└── .gitignore
```

---

## Funcionalidades Detalladas

### 1. Ingesta Automática SRATMA

El sistema se conecta a `https://sratma.mtc.gob.pe/wssratma/api/Mapa` utilizando endpoints públicos descubiertos mediante ingeniería inversa. El motor (`sratmaIngest.job.js`) implementa tres modos:

#### Backfill inicial
- Al arrancar, verifica si hay datos en DB.
- Si la DB está vacía, retrocede 90 días (configurable) e ingiere día por día.
- Procesa hasta 5000 accidentes por día con concurrencia configurable.
- Si hay más de 365 días de datos pendientes, itera en loops de 365 días hasta ponerse al día.
- Cada lote: lista IDs de SRATMA, sortea, verifica duplicados, fetches detalle con retry, mapea campos e inserta con `ON CONFLICT DO NOTHING`.

#### Tick en tiempo real
- Cada 15 segundos (configurable: `SRATMA_INTERVAL_MS`):
  1. Obtiene el último `external_id` registrado para la fuente SRATMA.
  2. Lista los IDs actuales desde la API.
  3. Filtra solo aquellos mayores al último conocido.
  4. Procesa hasta 200 accidentes nuevos por tick (`SRATMA_MAX_PER_TICK`).

#### Backfill periódico
- Cada 6 horas (configurable: `SRATMA_BACKFILL_INTERVAL_MS`), backfillea los últimos 3 días para capturar IDs que pudieron haberse omitido en ticks.

### 2. Deduplicación Idempotente
- **Constraint único:** `UNIQUE(fuente, external_id)` en la tabla `accidentes`.
- **Verificación pre-insert:** se chequea existencia antes de llamar a la API de detalle.
- **ON CONFLICT DO NOTHING:** para inserts directos sin error.

### 3. Reintentos Exponenciales (Retry)
Ante fallos en la API de SRATMA, se reintenta hasta 3 veces con backoff:
- 1er reintento: 1 segundo
- 2do reintento: 3 segundos
- 3er reintento: 7 segundos

### 4. SSE Streaming en Tiempo Real
Cuando el job de ingesta crea un nuevo accidente, el `eventBus` (pub/sub en memoria) lo publica. El endpoint `GET /stream/accidentes` mantiene conexiones SSE abiertas y empuja los eventos a todos los clientes conectados.

### 5. Mapa Interactivo (Leaflet)
- **Markers tipo pin SVG** coloreados por severidad:
  - 🟢 Verde = Gravedad Baja
  - 🟡 Amarillo = Gravedad Media
  - 🔴 Rojo = Gravedad Alta
- **Popups** con datos completos: fecha, hora, distrito, provincia, departamento, tipo, gravedad, vehículos involucrados.
- **Carga asíncrona:** Los accidentes existentes se cargan via REST; los nuevos llegan via SSE.
- **Clustering:** Los markers se agrupan/desagrupan según el nivel de zoom.

### 6. Filtros Geográficos
- Búsqueda por departamento, provincia o distrito con autocompletado.
- Al seleccionar un distrito se renderiza su polígono exacto desde PostGIS.
- Al seleccionar departamento/provincia se renderiza la geometría agregada.
- Selector de gravedad (Baja / Media / Alta) para filtrar markers.

### 7. KPIs en Tiempo Real
Tarjetas en el mapa que muestran:
- Total de accidentes registrados
- Conteo por nivel de severidad
- Puntaje promedio de severidad

### 8. Simulador de Accidentes
- Activado con la variable `SIMULATOR=on`.
- Genera accidentes ficticios en intervalos configurables (`SIMULATOR_INTERVAL_MS`).
- Útil para testing y demostraciones sin depender de la API real.

### 9. Auditoría de Ingesta
Cada ejecución del motor de ingesta (backfill o tick) se registra en la tabla `ingest_runs` con:
- Fuente, modo, timestamps de inicio/fin
- Rango de fechas procesado, intervalo usado
- Estadísticas: listados, batches, creados, duplicados, inválidos, errores
- Notas adicionales en JSONB

### 10. Endpoint de Monitoreo
`GET /ingest-status` devuelve estadísticas en vivo:
- Total de accidentes en DB por fuente
- Último accidente registrado
- Estado del último backfill y tick
- Rango de fechas cubierto

---

## Endpoints de la API REST

| Método | Ruta | Descripción | Controlador |
|--------|------|-------------|-------------|
| `GET` | `/health` | Health check | `app.js` |
| `GET` | `/ingest-status` | Estadísticas de ingesta en vivo | `app.js` |
| `GET` | `/accidentes` | Todos los accidentes | `accidentes.controller.js` |
| `POST` | `/accidentes` | Crear accidente manualmente | `accidentes.controller.js` |
| `GET` | `/accidentes/filtrados?distrito=&gravedad=` | Accidentes filtrados | `accidentes.controller.js` |
| `GET` | `/accidentes/:id/audit` | Auditoría por ID interno | `accidentes.controller.js` |
| `GET` | `/accidentes/external/:fuente/:external_id/audit` | Auditoría por fuente + ID externo | `accidentes.controller.js` |
| `GET` | `/distritos` | Lista de distritos (con búsqueda y límite) | `distritos.routes.js` |
| `GET` | `/distritos/:ubigeo/geojson` | GeoJSON del polígono de un distrito | `distritos.routes.js` |
| `GET` | `/distritos/geometria/agregada?departamento=&provincia=` | Geometría agregada por depto/provincia | `distritos.routes.js` |
| `GET` | `/stream/accidentes` | SSE streaming en tiempo real | `stream.routes.js` |
| `GET` | `/ingest-runs` | Historial de ejecuciones de ingesta | `ingestRuns.controller.js` |
| `GET` | `/ingest-runs/:id` | Detalle de una ejecución | `ingestRuns.controller.js` |

---

## Base de Datos (PostGIS)

### Tabla: `accidentes`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | ID interno |
| `fecha` | `DATE NOT NULL` | Fecha del accidente |
| `hora` | `TIME NOT NULL` | Hora del accidente |
| `distrito` | `TEXT` | Nombre del distrito |
| `ubigeo` | `TEXT` | Código UBIGEO (6 dígitos) |
| `tipo` | `TEXT` | Tipo de accidente |
| `gravedad` | `TEXT` | CHECK('Baja','Media','Alta') |
| `fallecidos` | `INTEGER` | Número de fallecidos |
| `lesionados` | `INTEGER` | Número de lesionados |
| `vehiculos` | `INTEGER` | Vehículos involucrados |
| `entidad` | `TEXT` | Entidad que reporta |
| `direccion` | `TEXT` | Dirección del siniestro |
| `codigo_externo` | `TEXT` | Código externo del siniestro |
| `fuente` | `TEXT` | Fuente de datos (e.g., 'sratma') |
| `external_id` | `BIGINT` | ID único en la fuente externa |
| `raw` | `JSONB` | Respuesta original de la API |
| `ubicacion` | `GEOGRAPHY(POINT, 4326)` | Coordenadas geográficas (con índice GIST) |
| `lat` | `DOUBLE PRECISION GENERATED` | `ST_Y(ubicacion)` — generado automáticamente |
| `lng` | `DOUBLE PRECISION GENERATED` | `ST_X(ubicacion)` — generado automáticamente |
| `created_at` | `TIMESTAMPTZ` | Fecha de creación del registro |
| `ingested_at` | `TIMESTAMPTZ` | Fecha de ingesta |
| `updated_at` | `TIMESTAMPTZ` | Fecha de última actualización (auto-actualizado por trigger) |

**Constraints:** `UNIQUE(fuente, external_id)` — garantiza idempotencia.

**Índices:** GIST sobre `ubicacion`, B-tree sobre `(fecha DESC, hora DESC)`, `ubigeo`, `gravedad`, `fuente`, `entidad`, `codigo_externo`.

### Tabla: `distritos`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `ubigeo` | `TEXT PRIMARY KEY` | Código UBIGEO de 6 dígitos (con CHECK) |
| `departamento` | `TEXT` | Departamento |
| `provincia` | `TEXT` | Provincia |
| `distrito` | `TEXT` | Nombre del distrito |
| `geom` | `geometry(MultiPolygon, 4326)` | Geometría del polígono (con índice GIST) |

**Índices:** GIST sobre `geom`, B-tree sobre `distrito`, `departamento`, `provincia`.

### Tabla: `ingest_runs`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `SERIAL PRIMARY KEY` | ID interno |
| `fuente` | `TEXT` | Fuente de datos |
| `mode` | `TEXT` | 'backfill' o 'tick' |
| `started_at` | `TIMESTAMPTZ` | Inicio de ejecución |
| `finished_at` | `TIMESTAMPTZ` | Fin de ejecución |
| `range_from` | `DATE` | Fecha inicial del rango procesado |
| `range_to` | `DATE` | Fecha final del rango procesado |
| `interval_ms` | `INTEGER` | Intervalo usado |
| `listed` | `INTEGER` | IDs listados desde API |
| `batch` | `INTEGER` | Lotes procesados |
| `created` | `INTEGER` | Registros creados |
| `duplicates` | `INTEGER` | Duplicados encontrados |
| `invalid` | `INTEGER` | Registros inválidos |
| `errors` | `INTEGER` | Errores en llamadas API |
| `notes` | `JSONB` | Notas adicionales |

**Índices:** B-tree sobre `fuente`, `mode`, `started_at DESC`.

---

## Variables de Entorno

### Backend (`.env` / `docker-compose.yml`)

#### Conexión a Base de Datos
| Variable | Default | Descripción |
|----------|---------|-------------|
| `PGHOST` | `db` | Host de PostgreSQL |
| `PGPORT` | `5432` | Puerto de PostgreSQL |
| `PGDATABASE` | `georisk` | Nombre de la base de datos |
| `PGUSER` | `georisk` | Usuario de PostgreSQL |
| `PGPASSWORD` | `georisk_pass` | Contraseña de PostgreSQL |

#### Configuración de Ingesta SRATMA
| Variable | Default | Descripción |
|----------|---------|-------------|
| `SRATMA_INGEST` | `on` | Activa/desactiva la ingesta automática |
| `SRATMA_INTERVAL_MS` | `15000` | Intervalo entre ticks (ms) |
| `SRATMA_MAX_PER_TICK` | `200` | Máximo de accidentes a procesar por tick |
| `SRATMA_CONCURRENCY` | `10` | Nivel de concurrencia en llamadas API |
| `SRATMA_BACKFILL_DEFAULT_DAYS` | `90` | Días a retroceder si DB está vacía |
| `SRATMA_BACKFILL_MAX_DAYS` | `365` | Máximo de días por loop de backfill |
| `SRATMA_BACKFILL_MAX_PER_DAY` | `5000` | Máximo de accidentes por día en backfill |
| `SRATMA_BACKFILL_INTERVAL_MS` | `21600000` | Intervalo entre backfills periódicos (6h) |
| `SRATMA_BACKFILL_PERIODIC_DAYS` | `3` | Días a retroceder en backfill periódico |

#### Simulador
| Variable | Default | Descripción |
|----------|---------|-------------|
| `SIMULATOR` | `off` | Activa/desactiva el simulador de accidentes |
| `SIMULATOR_INTERVAL_MS` | — | Intervalo entre accidentes simulados |

---

## Inicio Rápido

### Requisitos
- Docker Desktop / Docker Compose

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/Pierreyfff/georisk-mvp.git
cd georisk

# 2. Construir y levantar servicios
docker compose build --no-cache
docker compose up -d

# 3. Importar distritos (GeoJSON) a PostGIS
docker compose exec -T backend mkdir -p /tmp/data
docker cp frontend/data/peru_distrital_simple.geojson georisk-backend:/tmp/data/
docker compose exec backend node src/scripts/import_distritos_geojson.js /tmp/data/peru_distrital_simple.geojson

# 4. Verificar estado de ingesta
curl http://localhost:3000/ingest-status

# 5. Abrir en navegador
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

## Persistencia y Recuperación

### Volumen de datos
Los datos se almacenan en el volumen Docker `georisk_db_data`. Mientras exista, los datos persisten aunque los contenedores se detengan o eliminen.

```bash
# Eliminar volumen (borra TODOS los datos)
docker compose down -v
```

### Recuperación ante caídas
Si el sistema se apaga y vuelve a encender:
1. Al arrancar, detecta la última fecha con datos en DB.
2. Backfillea desde esa fecha +1 hasta hoy.
3. Si no hay datos (volumen nuevo o DB vacía), backfillea desde 90 días atrás.
4. Si hay más de 365 días de datos pendientes, backfillea en loops de 365 días hasta alcanzar.
5. Una vez al día, entra en modo tick (cada 15s) para mantener la data actualizada.

---

## Desarrollo Local

### Backend

```bash
cd backend
cp .env.example .env  # o usa el .env incluido
npm install
npm run dev           # con nodemon para recarga automática
```

### Frontend
Los archivos del frontend son estáticos. Puedes servirlos con cualquier servidor HTTP:

```bash
cd frontend
npx serve .           # Puerto 3000 por defecto
# O abre index.html directamente (sin proxy, algunas funciones no funcionarán)
```

### Script de Importación de Distritos
```bash
node src/scripts/import_distritos_geojson.js ../frontend/data/peru_distrital_simple.geojson
```

---

## Configuración de Nginx (Frontend)

El archivo `frontend/nginx.conf` configura:
- Servir archivos estáticos desde `/usr/share/nginx/html`
- Proxy reverso de `/api/` hacia `backend:3000`
- Manejo especial para `/api/stream/` (SSE): sin buffering, timeout de 1 hora
- Headers `no-cache` en todas las respuestas

---

## Plan de Mejora

Ver [`docs/PLAN_INGESTA.md`](./docs/PLAN_INGESTA.md) para el plan detallado de mejora del sistema de ingesta SRATMA, que documenta 7 deficiencias identificadas y sus fases de corrección propuestas.

---

## Notas Técnicas Adicionales

- **Sin tests automatizados:** El proyecto actualmente no cuenta con suite de pruebas. `package.json` tiene `"test": "echo \\"Error: no test specified\\" && exit 1"`.
- **Sin TypeScript:** Todo el backend usa CommonJS (`require`/`module.exports`). El frontend usa ES Modules via script tag `type="module"`.
- **Idioma:** Código, comentarios y documentación en español.
- **Seguridad:** Las credenciales de DB están en texto plano en `docker-compose.yml` y `.env`. El `.env` está commiteado en el repositorio.
- **Concurrencia:** Se usa un `asyncPool` custom para limitar las llamadas API concurrentes durante el procesamiento por lotes.
- **EventBus:** Implementación simple en memoria con `Set<callback>`. No apto para despliegues multi-instancia.
- **No hay CI/CD:** No se encontraron archivos de configuración de integración/despliegue continuo.
