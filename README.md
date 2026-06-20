# GeoRisk Analytics

Sistema de monitoreo y visualización en tiempo real de accidentes de tránsito en Perú. Ingiesta datos automáticamente desde la API pública de SRATMA (MTC) mediante ingeniería inversa de sus endpoints, los almacena con georreferenciación (PostGIS) y los despliega en un mapa interactivo con Leaflet.

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

El sistema se conecta a la API pública de SRATMA del MTC (`https://sratma.mtc.gob.pe/wssratma/api/Mapa`). Los endpoints fueron descubiertos mediante **ingeniería inversa** analizando el tráfico de red de la aplicación web de SRATMA:

1. **`/WSAbrirMapa`** — lista los IDs de accidentes activos en el mapa en un rango de fechas. Responde con un array de `{id, fecha, codigo}`.
2. **`/WSBuscarAccidente`** — dado un ID, devuelve el detalle completo (ubicación, tipo, gravedad, vehículos, etc.) en formato JSON.

El motor de ingesta (`sratmaIngest.job.js`) implementa tres modos:
- **Backfill inicial:** si la DB está vacía, retrocede 90 días e ingiere día por día con concurrencia configurable.
- **Tick en tiempo real:** cada 15s consulta nuevos IDs desde el último conocido y los procesa.
- **Backfill periódico:** cada 6h repasa los últimos 3 días para capturar IDs omitidos.

**Conciliación SRATMA:** Un cache en memoria (`sratmaCache.js`) mantiene los IDs activos del listado de SRATMA, actualizado en cada tick. El endpoint `/api/accidentes/stats` retorna el conteo verificado contra SRATMA, no el total crudo de la DB.

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
- `/api/accidentes/stats` retorna `totalAccidentes` = solo registros verificados contra SRATMA
- `/api/accidentes/reconcile` expone `{ dbTotal, sratmaListed, verified, checkedAt }`
- Mapa usa `?verified=true` para mostrar solo accidentes SRATMA-activos

---

## Base de Datos (PostGIS)

### Tabla `accidentes`
`UNIQUE(fuente, external_id)` garantiza idempotencia. Índices GIST sobre `ubicacion` (Geography Point), B-tree sobre `(fecha DESC, hora DESC)`, `ubigeo`, `gravedad`, `fuente`. Columnas `lat`/`lng` generadas automáticamente desde `ST_Y(ubicacion)` / `ST_X(ubicacion)`.

### Tabla `distritos`
Polígonos MultiPolygon con índice GIST. Código UBIGEO de 6 dígitos como PK.

### Tabla `ingest_runs`
Registro de cada ejecución del motor de ingesta (backfill/tick). Estadísticas: listados, batches, creados, duplicados, inválidos, errores.

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

## Notas Técnicas

- **Sin tests automatizados:** El proyecto no cuenta con suite de pruebas.
- **Sin TypeScript:** Backend en CommonJS, frontend en ES Modules vanilla.
- **Idioma:** Código y documentación en español.
- **EventBus:** Implementación simple en memoria con `Set<callback>`. No apto para multi-instancia.
- **Concurrencia:** `asyncPool` custom para limitar llamadas API concurrentes.
- **Seguridad:** Las credenciales de DB están en texto plano en `docker-compose.yml` (solo para desarrollo local). En producción, usar variables de entorno de Render.
