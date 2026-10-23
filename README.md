# Department-backend

API headless de **Daregular Dept.** (tienda de ropa, Colombia): catálogo, inventario, contenido editable (CMS), carrito, checkout y pagos con Wompi,
pedidos, clientes con Habeas Data, marketing, analítica e importador desde Shopify. NestJS 11 · TypeORM · PostgreSQL · Zod · OpenAPI.

- Plan y decisiones: [`docs/PLAN.md`](docs/PLAN.md) · contratos por fase: `docs/contracts/`.
- Guía de integración para el front y el panel admin: [`docs/API.md`](docs/API.md).
- Superficies: `/api/v1/storefront/*` (público), `/api/v1/admin/*` (personal con permisos), `/api/v1/auth/*`; operación sin prefijo (`/health`, `/ready`, `/version`, `/media/:key`, `/webhooks/wompi`).

## Requisitos

- Node ≥ 22.13 y yarn 1.x (`corepack enable`).
- Para desarrollo **no hace falta Docker ni Postgres instalado**: `yarn db:start` levanta un Postgres embebido.

## Arranque local

```bash
yarn install
cp .env.example .env            # ya apunta al Postgres embebido (puerto 5433)
yarn db:start                   # terminal 1: Postgres local (Ctrl+C para parar; datos en .data/pg)
yarn migration:run              # terminal 2: crea el esquema
OWNER_EMAIL=tu@correo.com OWNER_PASSWORD='una-contraseña-larga' yarn owner:create   # primer Owner (mín. 12 caracteres; en servidores mejor vía .env que en la línea de comandos: queda en el historial)
yarn start:dev                  # API en http://localhost:4000 (siembra el contenido del CMS la primera vez)
yarn catalog:seed               # opcional: catálogo demo (9 productos, colecciones all/men/women, stock 10)
yarn smoke                      # terminal 3: recorrido completo (ver "Smoke")
```

Swagger UI: `http://localhost:4000/docs` (JSON en `/docs-json`; desactivado por defecto con `NODE_ENV=production`).
`yarn owner:create` es idempotente y usa `OWNER_EMAIL`/`OWNER_PASSWORD` del entorno o del `.env`. El owner creado debe cambiar la contraseña en su primer login (`OWNER_MUST_CHANGE_PASSWORD=false` solo para CI/smoke; con `NODE_ENV=production` el arranque lo rechaza, y `REQUIRE_STAFF_2FA=false` en producción emite un warning al arrancar) y, con `REQUIRE_STAFF_2FA` (activo por defecto en producción), activar el 2FA.
Contenido del sitio: `SEED_DEFAULT_CONTENT=true` (por defecto) crea al arrancar los documentos publicados `settings/site`, `menu/main|footer`, `template/layout|home|collection|product|search|cart|404` y las páginas `community` y `contact` solo si no existen (ver `docs/CMS-SECTIONS.md`). Si la BD es WIN1252 (Postgres embebido en Windows), los caracteres fuera de ese código no se pueden guardar; créala en UTF8.

## Scripts

| Comando | Descripción |
| --- | --- |
| `yarn start:dev` | API con recarga |
| `yarn build` · `yarn start:prod` | Compila a `dist/` y la sirve (`node dist/main.js`) |
| `yarn lint` · `yarn typecheck` | ESLint · `tsc --noEmit` |
| `yarn db:start` | Postgres embebido |
| `yarn migration:generate src/database/migrations/Nombre` | Genera una migración desde las entidades |
| `yarn migration:run` · `yarn migration:revert` | Aplica / revierte (desarrollo, con ts-node) |
| `yarn migration:run:prod` | Aplica las migraciones desde `dist/` (CI y despliegue) |
| `yarn owner:create` | Crea el primer Owner |
| `yarn staff:reset-2fa <email>` | Recuperación: desactiva el 2FA de un miembro (perdió móvil y códigos), exige cambiar la contraseña, revoca sus sesiones y audita como `system` |
| `yarn staff:unlock <email>` | Recuperación: borra los bloqueos de login (`login_attempts`) de un miembro y audita como `system` |
| `yarn content:seed` | Crea los documentos CMS por defecto que falten (idempotente, nunca pisa ediciones). También se ejecuta al arrancar si `SEED_DEFAULT_CONTENT=true` (por defecto) |
| `yarn catalog:seed [--force]` | Catálogo demo: solo si no hay productos (con `--force` añade los que falten por handle). Imágenes por ruta relativa `/images/...` del front |
| `yarn smoke` | Comprobaciones contra una API en marcha (`API_URL`, por defecto `localhost:4000`) |
| `API_URL=… node scripts/export-openapi.mjs` | Descarga `/docs-json` a `docs/openapi.json` |

## Variables de entorno

Se validan con Zod al arrancar (`src/config/env.ts`): si falta o está mal una, el proceso se detiene con una lista legible.
`.env.example` las tiene todas comentadas. Resumen por fase (las marcadas **[PROD]** son obligatorias con `NODE_ENV=production`):

| Fase | Variables |
| --- | --- |
| 0 · Base | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `GIT_SHA`, `DATABASE_URL`, `DATABASE_SSL` **[PROD]** (`require`/`verify-full`), `DATABASE_CA_CERT`, `DATABASE_POOL_MAX`, `CORS_ORIGINS`, `PUBLIC_URL`, `STOREFRONT_URL`, `ADMIN_URL` (todas `https://` en producción), `TRUST_PROXY` **[PROD]**, `DOCS_ENABLED`, `THROTTLE_TTL_MS`, `THROTTLE_LIMIT`, `UPLOAD_DIR` |
| 1 · Identidad | `JWT_ACCESS_SECRET` **[PROD]**, `ENCRYPTION_KEY` **[PROD]**, `OWNER_EMAIL`, `OWNER_PASSWORD` (bootstrap) |
| 3 · CMS | `PREVIEW_TOKEN_SECRET` **[PROD]**, `STOREFRONT_REVALIDATE_SECRET` **[PROD]**, `STOREFRONT_SERVER_KEY` **[PROD]** |
| 4 · Comercio | `PAYMENT_PROVIDER` **[PROD]** (`wompi`), `MOCK_PAYMENTS_ENABLED` (**false** en producción), `ORDER_RESERVATION_MINUTES`, `WOMPI_API_URL` (en producción NO puede contener `sandbox`: `https://production.wompi.co/v1`), `WOMPI_PUBLIC_KEY` **[PROD]** (en producción debe empezar por `pub_prod_`; la API no arranca con claves de prueba), `WOMPI_INTEGRITY_SECRET` **[PROD]**, `WOMPI_EVENTS_SECRET` **[PROD]**, `WOMPI_EXPIRATION_ENABLED` (por defecto `false`; actívalo cuando el front reenvíe `expirationTime` como `expiration-time`) |
| 5 · Clientes/correo | `MAIL_TRANSPORT` **[PROD]** (`smtp`), `SMTP_URL` **[PROD]**, `MAIL_FROM`, `CUSTOMER_JWT_SECRET` **[PROD]** |

Secretos: `openssl rand -hex 32` (JWT, preview, revalidate, server key) y `openssl rand -base64 32` (`ENCRYPTION_KEY`, 32 bytes exactos).
`TRUST_PROXY` es el número de saltos de proxy (Railway = 1, Cloudflare + Railway = 2) o una lista de IP/CIDR; **nunca** `true`.
No uses `?sslmode=` en `DATABASE_URL`: el TLS se configura con `DATABASE_SSL`.

## Migraciones

`synchronize` está siempre apagado: todo cambio de esquema es una migración en `src/database/migrations/`.

```bash
yarn migration:generate src/database/migrations/NombreDelCambio   # requiere la BD al día
```

**Ruido conocido de TypeORM**: las migraciones generadas incluyen líneas espurias que hay que borrar a mano antes de commitear:

1. `DROP INDEX "idx_products_tags_gin"` (el índice GIN de etiquetas se creó con SQL y TypeORM no lo conoce; borrarlo rompería la búsqueda).
2. Cambios `ALTER COLUMN "id" SET DEFAULT …` / `DROP DEFAULT` de las columnas `id` (el default `gen_random_uuid()` es intencional).

Revisa siempre el `up()` generado; el `down()` debe deshacer solo lo que hace el `up()`.
En producción las migraciones se ejecutan como **paso de despliegue** (`yarn migration:run:prod`), nunca al arrancar la API.

## Smoke

`yarn smoke` recorre identidad, catálogo, CMS, comercio y clientes contra una API ya levantada. Necesita:
`OWNER_EMAIL`/`OWNER_PASSWORD` (un Owner existente), `MOCK_PAYMENTS_ENABLED=true` con `PAYMENT_PROVIDER=mock` en la API (para pagar pedidos de prueba) y
`DATABASE_URL` en el entorno del smoke (el flujo de clientes lee la bandeja de correo desde Postgres porque `MAIL_TRANSPORT=log` no envía nada).
El login de clientes está limitado a 5/min por IP: reinicia la API entre ejecuciones consecutivas del smoke. CI (`.github/workflows/ci.yml`) hace lint, typecheck, build,
migraciones, crea el Owner, arranca la API y ejecuta el smoke completo con un servicio Postgres 16.

## Planificadores in-process y varias instancias

No hay cola externa: cada instancia ejecuta sus propios temporizadores (todos con `unref`, no impiden apagar el proceso).

| Tarea | Frecuencia | Seguridad con varias instancias |
| --- | --- | --- |
| Publicación de contenido programado (`cms/content/content.scheduler.ts`) | 30 s | `FOR UPDATE SKIP LOCKED`, idempotente |
| Bandeja de correo (`mail/mail.worker.ts`) | 15 s | reclamo con `SKIP LOCKED` + lease de 2 min |
| Expiración de pedidos sin pagar y liberación de stock (`orders.scheduler.ts`) | 1 min | `SKIP LOCKED` |
| Limpieza de carritos, `idempotency_keys` (7 d), `processed_events` (90 d) | 1 h | lotes de 1000 con `SKIP LOCKED` |
| Tokens de un solo uso de clientes (`customer_tokens`, 7 d) y cuentas sin verificar (48 h) | 1 h | `SKIP LOCKED` |
| **Mantenimiento** (`src/maintenance`, ver abajo) | 1 h | **un solo ejecutor**: `pg_try_advisory_xact_lock` |
| Importador CSV (`ImportWorker`, `src/imports`) | 5 s | `SKIP LOCKED`, un job por instancia |

Con varias instancias no se duplica trabajo ni se corrompen datos. Lo que **sí** es por instancia: el rate limit (memoria local, el límite efectivo se multiplica por
el número de instancias; para límites estrictos globales añade un límite en el proxy/Cloudflare) y la caché de disco de `UPLOAD_DIR` (ver Media abajo).
Puedes ejecutar `POST /admin/maintenance/run` (permiso `settings:write`, 2/min) para lanzar una pasada a mano y ver el resumen por tarea.

### Mantenimiento (retención)

Cada hora, una sola instancia (bloqueo asesor de Postgres ligado a una transacción: se libera sola si la conexión muere), en lotes de 1000 y con cada tarea aislada:

- `refresh_tokens` y `customer_refresh_tokens` expirados o revocados hace más de 30 días.
- `email_outbox` enviados/fallidos con más de 30 días borrados; con más de 7 días se vacían `body_html`/`body_text` (pueden contener enlaces de restablecimiento).
- `content_versions` `cancelled|superseded`: se conservan las 100 más recientes por documento (nunca se tocan `published`/`scheduled`).
- `import_jobs` terminados con más de 180 días, junto con su CSV en `UPLOAD_DIR/imports`.
- Pedidos etiquetados `anonymize-on-close` ya cerrados: `CustomerErasureService.anonymizeClosedTaggedOrders(500)` (Habeas Data).

Ya cubiertos por los planificadores de otras fases (no se duplican): `customer_tokens` y clientes sin verificar, `idempotency_keys`, `processed_events`, carritos expirados.
`MaintenanceModule` debe estar importado en `AppModule`.

## Despliegue recomendado

**API en Railway o Render + Postgres en Neon o Supabase + media en Cloudflare R2.**

1. Base de datos: crea el proyecto (Neon/Supabase), copia la cadena de conexión **sin** `?sslmode=` y usa `DATABASE_SSL=require` (o `verify-full` con `DATABASE_CA_CERT` si el host lo pide, p. ej. Supabase). Con pooler (pgbouncer en modo transacción), usa una URL directa para migraciones.
2. Servicio de la API: build con el `Dockerfile` (o `yarn build` + `node dist/main.js`). Configura todas las variables de la checklist. `TRUST_PROXY=1` en Railway/Render.
3. **Migraciones**: paso de despliegue antes de arrancar la nueva versión, con el mismo entorno: `yarn migration:run:prod` (en Railway: comando de pre-deploy; en Render: `preDeployCommand`). Nunca en el arranque.
4. Primer Owner: ejecútalo una vez desde tu máquina apuntando a la BD de producción (`OWNER_EMAIL=… OWNER_PASSWORD=… DATABASE_URL=… yarn owner:create`); necesita ts-node (dependencia de desarrollo), por eso no va en la imagen.
5. Salud: `GET /health` (proceso vivo, lo usa el `HEALTHCHECK` del Dockerfile) y `GET /ready` (BD).
6. Front/Admin: dominios `https://` incluidos en `CORS_ORIGINS`; el servidor Next presenta `STOREFRONT_SERVER_KEY`; el front implementa `/api/revalidate` y `/api/preview` (ver `docs/API.md`).
7. Wompi: en su panel, la URL de eventos es `https://<api>/webhooks/wompi`.

**Media (estado actual y siguiente paso)**: hoy solo existe el driver de **disco local** (`UPLOAD_DIR`). En Railway/Render el disco es efímero salvo que montes un volumen persistente
(y entonces solo puede haber **una** instancia escribiendo). Para varias instancias y CDN hay que implementar el driver S3-compatible (Cloudflare R2) detrás de `StorageDriver`
(pendiente; el resto del sistema ya depende solo de esa interfaz). Hasta entonces: una instancia + volumen en `UPLOAD_DIR`.

Docker (referencia **no probada localmente**, sin Docker en la máquina de desarrollo): `Dockerfile` multi-etapa (node:22-alpine, usuario no root, solo `dist` + dependencias de producción, `HEALTHCHECK` con wget)
y `docker-compose.yml` de ejemplo (API + postgres:16). Validar en CI o en tu host antes de confiar en ellos. Ejecuta las migraciones con `docker compose run --rm api yarn migration:run:prod`.

## Checklist de producción

- [ ] `NODE_ENV=production`, `PORT` según la plataforma.
- [ ] `DATABASE_URL` (sin `sslmode`), `DATABASE_SSL=require|verify-full`, `DATABASE_CA_CERT` si aplica, `DATABASE_POOL_MAX` acorde al plan de la BD y al número de instancias.
- [ ] `PUBLIC_URL`, `STOREFRONT_URL`, `ADMIN_URL`, `CORS_ORIGINS`: todos `https://`, sin barra final en CORS.
- [ ] `TRUST_PROXY` con los saltos reales (1 o 2).
- [ ] Secretos únicos y aleatorios (no reutilices entre sí): `JWT_ACCESS_SECRET`, `CUSTOMER_JWT_SECRET`, `PREVIEW_TOKEN_SECRET`, `STOREFRONT_REVALIDATE_SECRET` (idéntico en el front), `STOREFRONT_SERVER_KEY` (idéntico en el servidor Next), `ENCRYPTION_KEY` (base64 de 32 bytes; **guárdala fuera de la BD**: perderla vuelve ilegibles los secretos cifrados).
- [ ] Pagos: `PAYMENT_PROVIDER=wompi`, `MOCK_PAYMENTS_ENABLED=false`, `WOMPI_API_URL` de producción (sin `sandbox`), `WOMPI_PUBLIC_KEY` (`pub_prod_…`), `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`; URL de eventos configurada en Wompi.
- [ ] Correo: `MAIL_TRANSPORT=smtp`, `SMTP_URL`, `MAIL_FROM` con dominio verificado (SPF/DKIM).
- [ ] `DOCS_ENABLED` sin definir (apagado en producción) salvo que lo necesites.
- [ ] `UPLOAD_DIR` en un volumen persistente (o driver S3 cuando exista).
- [ ] Migraciones aplicadas (`yarn migration:run:prod`) y primer Owner creado; activar 2FA para el Owner.
- [ ] Backups automáticos de la BD activados y **restauración probada**.
- [ ] Alertas sobre `/ready` y sobre errores 5xx; los logs (pino, JSON) van a la plataforma y no incluyen credenciales.
- [ ] `docs/SECURITY-REVIEW.md` revisado: sin hallazgos críticos/altos abiertos.

El arranque **falla** si en producción falta cualquiera de los obligatorios o hay ajustes de desarrollo (`src/config/env.ts`): eso es intencional.

## Seguridad (resumen)

- Deny-by-default: toda ruta exige sesión salvo `@Public()`; los permisos se declaran por ruta con `@RequirePermissions` y se auditan las escrituras (`AuditLog`).
- Contraseñas con argon2id; JWT de acceso corto + refresh rotativo en cookie httpOnly (`dept_rt` personal, `dept_ct` clientes) con detección de reutilización; bloqueo tras intentos fallidos; 2FA TOTP opcional.
- Validación de entrada con Zod en el borde; SQL parametrizado; errores uniformes sin trazas; `helmet` y CORS por lista blanca.
- Rate limiting global y estricto en autenticación, checkout, formularios y exportaciones; `X-Visitor-Ip` solo se acepta con `X-Storefront-Key`.
- Dinero y stock con transacciones y bloqueos; pagos con firma verificada sobre el cuerpo crudo e idempotencia; `MOCK_PAYMENTS_ENABLED` no puede activarse en producción.
- Secretos de terceros cifrados (`ENCRYPTION_KEY`); tokens de vista previa y revalidación firmados (HMAC/JWT) con expiración y `ts` anti-replay.
- Habeas Data: acceso (`data-export`), borrado/anonimización de clientes y de pedidos etiquetados; cuerpos de correo vaciados a los 7 días; sin datos personales en logs (la query string nunca se registra).
- Media: solo imágenes validadas por contenido, claves exactas (sin listado de directorios); los CSV de importación nunca se sirven.

## Estructura

```
src/
  config/        variables de entorno validadas (token ENV)
  database/      TypeORM: módulo, DataSource del CLI, entidad base (uuid v7), naming snake_case, transacciones, migrations/
  common/        errores uniformes, paginación (cursor + offset), auth (decoradores), throttling, clock, dinero, CSV seguro
  identity/      personal, roles/permisos, sesiones, 2FA, guards
  audit/         registro de auditoría
  catalog/       productos, variantes, colecciones, metafields, búsqueda, storefront
  inventory/     ubicaciones, niveles, ajustes
  cms/           contenido versionado, secciones, media, redirecciones, vista previa, revalidación
  commerce/      carrito, checkout, descuentos, envíos, impuestos, pedidos, pagos (Wompi/mock)
  customers/     cuentas, direcciones, Habeas Data, limpieza
  mail/          bandeja de salida, plantillas, worker
  marketing/     newsletter, contacto
  analytics/     panel de métricas
  imports/       importador Shopify por CSV (Fase 8)
  maintenance/   mantenimiento horario y POST /admin/maintenance/run
  health/        /health · /ready · /version
scripts/         dev-db, smoke*, create-owner, export-openapi
docs/            PLAN.md · API.md · contracts/
Dockerfile · docker-compose.yml · .env.example · .github/workflows/ci.yml
```

## Convenciones

- TypeScript estricto sin `any`; DTOs con Zod (`createZodDto`); errores con `AppException`; hora con `Clock`; escrituras críticas con `TransactionService` y `AuditService`.
- Pruebas: scripts de smoke + revisión de seguridad (sin suites unitarias, decisión #4 del plan).
- Una rama por parte, commits pequeños en español, PR y aprobación antes de mergear.
