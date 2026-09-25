# Revisión de seguridad final: backend (fases 0 a 8)

- **Rama:** `feature/hardening` (commit `3ef6c82`)
- **Fecha:** 2026-09-25
- **Tipo:** revisión estática de solo lectura. No se ejecutó código, tests, migraciones ni Docker.

## 1. Resumen ejecutivo

El backend tiene una base sólida:

- Deny-by-default global, con permisos explícitos en **todos** los endpoints `/admin/*`.
- Todo el SQL crudo va parametrizado.
- Zod valida la entrada, sin asignación masiva.
- La configuración de producción está validada.
- Los logs no incluyen query strings ni credenciales.
- Los workers y schedulers son seguros con varias instancias (`SKIP LOCKED` / advisory lock).
- Las correcciones de concurrencia y dinero de auditorías anteriores siguen vigentes.

El importador de la fase 8 está bien construido en lo técnico:

- Parseo estricto con límites.
- CSV privado, con nombre derivado del uuid.
- Saneado del HTML con lista blanca correcta.
- `dryRun` con rollback real.
- Stock idempotente, respetando lo reservado.

Los problemas relevantes están en la **lógica de negocio del importador de clientes y productos**:

- Filtración de datos personales (PII) hacia cuentas no verificadas.
- Reactivación de consentimiento de marketing.
- Resurrección de clientes borrados por Habeas Data.
- Sobrescritura destructiva del catálogo.

También hay un hueco de configuración en Wompi para producción.

**Veredicto global: PASS WITH FIXES.** Hay que corregir H-1 antes de importar clientes reales en producción. Los MEDIUM deben corregirse antes o durante el go-live. Ningún hallazgo permite a un anónimo tomar el control del panel ni mover dinero.

## 2. Hallazgos y estado tras la corrección

Actualización: correcciones aplicadas por el corrector final (sin commitear); verificadas con typecheck, lint, migraciones up/down/up, build y smoke completo en verde.

| ID | Sev. | Archivo:línea | Escenario | Arreglo propuesto | Estado |
| --- | --- | --- | --- | --- | --- |
| H-1 | **HIGH** | `src/imports/customer-importer.ts:129-133, 150-174` + `src/customers/auth/customer-auth.service.ts:126` | Un atacante registra `victima@x.com` con su propia contraseña. La cuenta queda sin verificar, pero **el login no exige email verificado** (`usable` solo mira `passwordHash`, `isActive` y `anonymizedAt`). Cuando el staff importa el CSV de Shopify, el importador encuentra ese cliente "existente" y le **fusiona el nombre, el teléfono y la dirección reales** de la víctima (añade la dirección por defecto si no tiene ninguna). Luego el atacante entra y lee esos datos por `GET /me`, `/me/addresses` o `/me/data-export`. Además, la dirección añadida impide que el purgado de cuentas no verificadas de 48 h borre la cuenta. | En el `SELECT` del importador leer también `password_hash` y `email_verified_at`. Si `password_hash IS NOT NULL AND email_verified_at IS NULL`, **no fusionar PII**. Hay dos opciones: saltar la fila con el código `UNVERIFIED_ACCOUNT`, o convertir la cuenta en invitado (`password_hash = NULL`, revocar sesiones y tokens) antes de fusionar. Como defensa en profundidad, valorar exigir el email verificado para iniciar sesión, o al menos para ver direcciones y exportar datos. | **Estado:** **Corregido.** El importador salta la fila con `ACCOUNT_UNVERIFIED_SKIPPED` si la cuenta tiene contraseña y email sin verificar (no fusiona datos ni direcciones); el purgado de no verificados ya no depende de la etiqueta. Abierto (defensa en profundidad): el login sigue sin exigir email verificado. |
| M-1 | MEDIUM | `src/imports/customer-importer.ts:142, 156, 165` | Un cliente que se **dio de baja** del marketing en esta tienda (`accepts_marketing=false`, verificado) vuelve a quedar suscrito al reimportar un export antiguo de Shopify con `Accepts Email Marketing=yes`. Además, `marketing_consent_at` se fija a la **fecha de importación**: el sistema registra un consentimiento que el titular no dio en esa fecha (riesgo para Ley 1581 / Habeas Data). | No activar nunca el marketing en clientes existentes desde el importador. En clientes nuevos, guardar el origen (`consent_source='shopify-import'`) y la fecha original de Shopify si existe, o dejar `accepts_marketing=false` y pedir doble opt-in. | **Estado:** **Corregido.** El importador nunca cambia `accepts_marketing` ni la fecha de consentimiento de clientes existentes; solo consiente en clientes nuevos con `yes` (y solo cuenta con email verificado). La fecha es la de importación (Shopify no aporta una fiable). |
| M-2 | MEDIUM | `src/imports/customer-importer.ts:129-150` + `src/customers/customer-erasure.service.ts:38-46` | El borrado por Habeas Data reemplaza el email por `deleted+<id>@invalid`. Si luego se importa un CSV que contiene el email original, el importador no encuentra al cliente y **crea uno nuevo con nombre, teléfono, dirección y marketing**. El chequeo `anonymized_at` de la línea 150 nunca se cumple. El titular que pidió la supresión reaparece. | Mantener una lista de supresión con el HMAC del email borrado (clave de servidor), escrita en `erase()`. El importador (y opcionalmente el registro) debe rechazar esos emails con `ERASED_SUBJECT`. | **Estado:** **Corregido (parcial).** Tabla `erasure_suppressions` (sha256 del email normalizado, escrita en `erase()`); el importador salta con `SUPPRESSED` y el registro responde 202 sin crear nada. Limitación abierta: el titular no puede volver a registrarse hasta que el personal borre su fila; no cubre borrados anteriores a la migración. |
| M-3 | MEDIUM | `src/imports/product-importer.ts:172-182, 288-296` | Reimportar un CSV parcial (p. ej. solo `Handle, Title, Variant Price` para actualizar precios) tiene dos efectos. (1) Sin columnas `Status`/`Published`, `wantActive=false` y **todos los productos activos pasan a `draft`**: el catálogo desaparece de la tienda. (2) Se **borran** `descriptionHtml`, `vendor`, `productType`, `tags` y los campos SEO, porque una columna ausente se trata como vacía. Lo dispara el staff con `import:write`, pero el daño es masivo e inmediato (sin auditoría por producto). | Distinguir "columna ausente" (`!(col in cells)` / `headers`) de "celda vacía". Si la columna no existe, conservar el valor actual; eso incluye el estado. Documentarlo. | **Estado:** **Corregido.** Una columna ausente no toca el campo (producto y variante: SKU, compare-at, peso, barcode, inventario); sin `Status`/`Published` se conserva el estado. |
| M-4 | MEDIUM | `src/config/env.ts:79-82, 134-137` + `src/commerce/payments/wompi.provider.ts:103-108` | En producción basta con que existan `WOMPI_*`, pero no se exige que sean de producción. Con `WOMPI_API_URL` en su valor por defecto (sandbox) y claves `pub_test_…`, el API arranca. Además, `environmentMatches` acepta eventos `test` cuando la clave es de test, así que **pagos con tarjetas de prueba marcarían como pagados pedidos reales**. | En `superRefine` con `NODE_ENV=production`, exigir `WOMPI_API_URL` = `https://production.wompi.co/v1`, `WOMPI_PUBLIC_KEY` que empiece por `pub_prod_`, y secretos de integridad y eventos con prefijo `prod_` (formato Wompi). En el webhook, rechazar `environment !== "prod"` en producción. | **Estado:** **Corregido.** En producción `env.ts` exige `WOMPI_PUBLIC_KEY` `pub_prod_…` y `WOMPI_API_URL` sin `sandbox`; documentado en el README. Abierto: no se valida el prefijo de los secretos de integridad/eventos. |
| M-5 | MEDIUM | `src/catalog/products/dto/product-create.dto.ts:8`, `src/catalog/collections/dto/collection-create.dto.ts:8` (y los DTO de update) | El importador sanea `Body (HTML)`, pero `descriptionHtml` creado o editado por la API admin se guarda **sin sanear**. Un usuario con `products:write`/`collections:write` (rol `editor`) puede almacenar `<script>` u `onerror=`. Si la tienda lo pinta con `dangerouslySetInnerHTML`, hay XSS persistente contra los clientes (sesión y acciones en su cuenta). No está documentado en `docs/API.md`. | Aplicar `sanitizeBody` (el mismo de `cell-parsers.ts`) en los servicios de productos y colecciones al crear, actualizar, duplicar y en operaciones masivas. Documentar que el campo se entrega ya saneado. | **Estado:** **Corregido.** `sanitizeRichText` (`src/common/html/sanitize.ts`) se aplica al crear y actualizar productos y colecciones, y en el importador. |
| L-1 | LOW | `src/database/db-options.ts:42` + `src/maintenance/maintenance.service.ts:71-81` | La transacción que mantiene el `pg_try_advisory_xact_lock` queda *idle in transaction* mientras las tareas corren en otras conexiones. Si la pasada dura más de 60 s, Postgres mata esa sesión (`idle_in_transaction_session_timeout`): se pierde el lock (otra instancia puede solaparse) y el commit falla, así que la pasada se reporta como fallida aunque hizo el trabajo. Las tareas son idempotentes, por eso el impacto es bajo. | Usar `pg_try_advisory_lock` (de sesión) más `pg_advisory_unlock` en `finally`, o `SET LOCAL idle_in_transaction_session_timeout = 0` dentro de esa transacción. | **Estado:** **Corregido.** Lock de sesión `pg_try_advisory_lock` con `pg_advisory_unlock` en `finally`, sin transacción abierta. |
| L-2 | LOW | `src/identity/identity.seed.ts:14`, `scripts/create-owner.ts:28` | Los permisos de los roles de sistema solo se sincronizan al ejecutar `owner:create`. En una BD ya desplegada, ningún rol (ni Owner) tiene `import:read`/`import:write` hasta volver a ejecutarlo, y el importador responde 403. No está documentado como paso de actualización. | Migración de datos que actualice `roles.permissions` de los roles `is_system`, o seed idempotente al arrancar. Documentar el paso. | **Estado:** **Corregido.** `RoleSyncService` sincroniza en cada arranque los permisos de los roles de sistema (`is_system`) con `ROLE_DEFAULTS`. |
| L-3 | LOW | `src/database/migrations/1790338745227-Commerce.ts:23` vs `1790296815765-Catalog.ts` y `src/imports/cell-parsers.ts:44` | Hay longitudes incoherentes. `order_lines.sku` es `varchar(100)` y `variants.sku` es `varchar(120)`; `order_lines.image_url` es `varchar(1000)`, pero el importador acepta URLs de hasta 2000. El checkout de esos productos falla con 400 "A value is too long". Además, `variants.title` es `varchar(255)`, pero el título unido de tres opciones puede llegar a 771 caracteres (INTERNAL_ERROR en la fila). | Alinear las columnas (migración) o limitar SKU a 100, URL a 1000 y el título de variante a 255 en el importador y en los DTO. | **Estado:** **Corregido.** Migración `Suppressions`: `order_lines.sku` a 120 y `image_url` a 2000; el importador limita el título de variante a 255. |
| L-4 | LOW | `src/imports/import.worker.ts:124, 165-171`, `src/maintenance/maintenance.controller.ts:15` | Los eventos `import:start`/`import:finish` se registran sin actor, porque corren fuera del contexto de la petición. Los cambios de PII y precios por fila no se auditan. La ejecución manual de `/admin/maintenance/run` no se audita. | Incluir `createdBy` en el `diff` de auditoría del job. Auditar `maintenance:run` con el actor. | **Estado:** **Corregido (parcial).** `import:start`/`finish` incluyen `createdBy` y `maintenance:run` se audita con actor. Abierto: no hay auditoría por fila. |
| L-5 | LOW | `src/customers/customers-cleanup.scheduler.ts:52` | Los clientes importados solo se libran del purgado de "no verificados" por la etiqueta `shopify-import`. Si un admin la quita (PATCH de tags), el cliente se borra físicamente pasadas 48 h si no tiene pedidos ni direcciones. | Basar la exclusión en `password_hash IS NULL` (invitado) o en una columna `source` no editable. | **Estado:** **Corregido.** El purgado solo excluye cuentas sin contraseña (invitados), no la etiqueta. |
| L-6 | LOW | `src/imports/csv-reader.ts:25`, `src/imports/import.worker.ts:132, 140` | El parseo síncrono (`csv-parse/sync`) y el saneado de hasta 10 MB se hacen en el hilo del API: bloquean el event loop unos segundos en la instancia que atiende tráfico. Solo lo puede disparar el staff. | Procesar en `worker_threads` o en un proceso aparte, o usar la API en streaming. | **Estado:** **Abierto.** Parseo síncrono en el hilo del API; solo lo dispara el personal. |
| L-7 | LOW | `src/imports/product-importer.ts:409-444` | Las imágenes importadas quedan como URLs https externas de cualquier host. El navegador del cliente las pide a terceros (privacidad y tracking) y el contenido puede cambiar fuera de control. | Lista blanca de hosts (`cdn.shopify.com`) hasta migrarlas a `/media`. | **Estado:** **Abierto.** Las imágenes siguen siendo URLs https externas (decisión de producto). |
| L-8 | LOW | `src/imports/import-file.storage.ts:22` | El CSV se guarda en el disco local de la instancia que recibe la subida. Con varias instancias, otra puede reclamar el job y fallar con `FILE_MISSING`. El README ya limita el despliegue a una instancia por la media. | Almacenar el CSV en la BD (bytea) o en el driver S3 cuando exista. | **Estado:** **Abierto.** El CSV sigue en disco local; despliegue de una sola instancia. |
| L-9 | LOW | `.github/workflows/ci.yml` | No hay bloque `permissions:` (el `GITHUB_TOKEN` usa los permisos por defecto) y las actions se fijan por tag, no por SHA. | Añadir `permissions: { contents: read }` y fijar por SHA. | **Estado:** **Corregido (parcial).** `permissions: contents: read` añadido. Abierto: fijar actions por SHA. |
| L-10 | LOW | `docker-compose.yml` (servicio `api`) | El compose de referencia usa `NODE_ENV=development` publicando `4000:4000` en todas las interfaces: docs activos, secretos opcionales y proveedor de pagos `mock`. Si alguien lo despliega tal cual en un servidor, queda expuesto en modo desarrollo. | Publicar `127.0.0.1:4000:4000` y añadir un aviso más visible. | **Estado:** **Corregido.** El compose publica solo en `127.0.0.1:4000`. |
| L-11 | LOW | `scripts/create-owner.ts:14-51`, `README.md:22, 124` | `owner:create` no aplica política de contraseña. El README propone pasar `OWNER_PASSWORD=…` en la línea de comandos, lo que la deja en el historial del shell. | Validar longitud y complejidad como en el alta de staff. Recomendar `.env` o un prompt. | **Estado:** **Corregido.** `owner:create` exige 12 a 256 caracteres y el README recomienda `.env`. |
| L-12 | LOW | `src/customers/auth/customer-auth.service.ts:91` | Comentario obsoleto: dice que "nada más crea clientes, siempre tiene contraseña", pero el importador crea invitados sin contraseña. El comportamiento es correcto (envía `account_exists` con enlace a *forgot-password*), pero el comentario induce a error. | Actualizar el comentario. | **Estado:** **Corregido.** Comentario actualizado. |
| L-13 | LOW | `docs/API.md:291` | Documentación desfasada: el importador aparece como "lo añade la Fase 8… cuando esté desplegado". Las rutas `/admin/import/jobs` (POST, GET, `GET /:id`, `POST /:id/cancel`) no están en la tabla. | Añadirlas, con límites y formato. | **Estado:** **Corregido.** Rutas del importador, mantenimiento y supresión documentadas en `docs/API.md`. |

## 3. Verificado correcto

### Importador (fase 8)

- **Parseo:** RFC 4180 estricto (`relax_quotes`/`relax_column_count` desactivados), BOM, cabeceras normalizadas sin vacías ni duplicadas.
- **Límites:** 5000 filas, 64 columnas, 100 000 caracteres por celda y 10 MB. El archivo debe ser UTF-8 sin NUL y con extensión `.csv`.
- **Mensajes de error:** nunca citan el registro, solo el código y la línea.
- **Almacenamiento:**
  - Clave `<uuid>.csv` generada en el servidor, con regex y comprobación de ruta dentro de la raíz.
  - `wx` + `0600`.
  - `/media/:key` solo sirve claves de imagen exactas: el CSV no se puede descargar.
  - El nombre del cliente es solo una etiqueta (`basename`, sin caracteres de control).
  - El CSV se borra al terminar, cancelar, fallar o quedar huérfano, y el mantenimiento lo purga.
- **`sanitize-html`:**
  - Lista blanca mínima.
  - Sin `style`/`on*`/`class`.
  - `href` limitado a https/mailto/tel y `src` solo a https.
  - Sin URLs relativas de protocolo.
  - Descarta el contenido de `script`/`style`.
  - Añade `rel=noopener`.
- **Inyección de fórmulas:** la exportación CSV (`csvCell`) neutraliza `= + - @ TAB CR` aunque el importador quite el apóstrofo inicial.
- **Worker:**
  - Reclamo con `FOR UPDATE SKIP LOCKED`.
  - Cancelación comprobada entre lotes y en cada `saveProgress` (condición `status='running'`).
  - Jobs huérfanos pasan a `failed` a los 15 min.
  - Savepoint por unidad: una fila mala no aborta el lote.
- **`dryRun`:** todo (productos, opciones, variantes, `media`, `product_media`, niveles y ajustes de inventario, clientes, direcciones) usa el `EntityManager` de la transacción, que se revierte con `DryRunRollback`. No hay secuencias implicadas (ids uuid). No hay efectos externos: ni correo, ni revalidación, ni auditoría dentro del lote.
- **Stock:** nivel absoluto idempotente (solo mueve la diferencia) con `FOR UPDATE`. Rechaza bajar por debajo de lo reservado, con el CHECK `reserved <= on_hand` como red. Registra el ajuste.
- **Variantes:** se concilian por SKU o por combinación. El SKU está protegido entre productos (en el plan y en la BD). No duplica ni borra variantes ausentes.
- **Clientes importados:** sin contraseña y sin verificar. El registro con el mismo email no toma la cuenta (`ON CONFLICT DO NOTHING` + correo `account_exists`). Solo *reset-password* (que prueba el buzón) fija la contraseña. El marketing solo cuenta con el email verificado, tanto en exportaciones como en filtros.

### Mantenimiento

- Advisory lock por transacción.
- Lotes con `LIMIT` y `SKIP LOCKED`; cada tarea aislada.
- Solo purga filas terminales: tokens caducados o revocados hace más de 30 días, outbox `sent`/`failed`, versiones `cancelled`/`superseded` más allá de las 100 últimas (nunca `published`/`scheduled`), jobs terminados.
- Nombres de tabla constantes.
- Endpoint protegido con `settings:write` y límite de 2 por minuto.

### Transversal

- **(a) Mapa de endpoints (27 controladores):**
  - Todos los `/admin/*` llevan `@RequirePermissions`: ninguno queda abierto a "cualquier staff autenticado".
  - Solo `/auth/logout|me|2fa/*|change-password` exigen únicamente autenticación, y está justificado porque actúan sobre el propio usuario.
  - Los `@Public()` son la tienda, la salud, la media, el webhook firmado y el pago simulado (solo si se cumplen tres condiciones de entorno).
  - `@CustomerAuth()` aplica un guard propio con un secreto distinto y recarga el cliente en cada petición.
- **(b) IDOR y asignación masiva:**
  - Cuenta: todas las consultas filtran por `customerId`.
  - Pedido público: token comparado en tiempo constante.
  - Carrito: exige `X-Cart-Token`.
  - DTO Zod (36 `strict`), sin `Object.assign`/`merge` de entradas.
- **(c) SQL:** todo parametrizado. Las interpolaciones son constantes (tablas y columnas fijas, `ORDER BY` por lista blanca `SORTS`/`sortBy`, placeholders de `SqlParams`). No se encontró inyección.
- **(d) Configuración de producción:** exige https, CORS https, SSL de BD, `TRUST_PROXY` (sin `true`), todos los secretos, SMTP, Wompi y mock apagado. Los secretos efímeros solo existen fuera de producción y los docs están apagados por defecto. **Salvo M-4.**
- **(e) Rate limiting:** límites específicos en login, registro, olvido y reset, verificación, checkout, carrito, newsletter, contacto, test-send y mantenimiento. La clave de visitante solo se acepta con `STOREFRONT_SERVER_KEY` en comparación de tiempo constante. El límite es en memoria por instancia, y está documentado.
- **(f) Logs:** redacción de `authorization`/`cookie`/claves, URL sin query string, errores 5xx sin SQL ni valores, y los mensajes de fila del importador no contienen celdas.
- **(g) Auditoría:** staff, clientes (reset, verificación, borrado, exportación), pedidos, descuentos, envíos, importación (creación, cancelación, inicio, fin) y exportaciones CSV. Salvo L-4.
- **(h) Dependencias:** conjunto acotado y conocido (NestJS 11, TypeORM, pg, argon2, jose, helmet, zod, csv-parse, sanitize-html, multer 2, nodemailer). No hay paquetes dudosos. `embedded-postgres` es beta, pero solo en dev.
- **(i) Concurrencia y dinero:** siguen vigentes:
  - `reserved_quantity` por línea con CHECK.
  - Reservas con `on_hand - reserved >= $n` y `RETURNING`.
  - `execUpdate` que cuenta filas afectadas.
  - Idempotencia de checkout con `idempotency_keys ... FOR UPDATE`.
  - Webhooks deduplicados (`processed_events`).
- **(j) Varias instancias:** cada instancia ejecuta ContentScheduler, OrdersScheduler, CartCleanup, CustomersCleanup, MailWorker e ImportWorker (con `SKIP LOCKED`) y Maintenance (advisory lock). Todo es seguro, salvo L-1 (solape) y L-8 (CSV en disco local).
- **(k) Migraciones:** 6 en orden temporal coherente, todas con `down`, `synchronize:false` y `migrationsRun:false`. La de Imports incluye un ajuste inocuo del default de `tax_settings`. Un `migration:run` sobre BD vacía se ejecuta en CI, pero **aquí no se ejecutó**.
- **(l) Pendientes y código muerto:** no hay `TODO`/`FIXME`. Hay código legado documentado (`unsubscribe_token_hash`). Las inconsistencias de documentación están en L-12 y L-13.
- **Docker y secretos:**
  - La imagen corre como `node`, en multi-stage, con dependencias de producción únicamente.
  - `.dockerignore` excluye `.env`, `.data` y `uploads`.
  - Solo `.env.example` está versionado y no contiene secretos reales. El `.env` local no está en git y solo tiene valores de desarrollo.
  - Postgres no se publica en el compose.

## 4. Limitaciones

- Revisión **estática**: no se ejecutaron el API, los tests, los smoke, las migraciones ni Docker.
- **Wompi real no se probó** (ni la firma real, ni sandbox frente a producción, ni reembolsos).
- No se auditó el front (`Department-frontend`). La severidad de M-5 depende de cómo pinte `descriptionHtml`.
- Las versiones de las dependencias no se contrastaron con bases de CVE en línea (sin acceso de red para `yarn audit`).
- El comportamiento de TypeORM con savepoints anidados y de `csv-parse` se dedujo del código y de la documentación conocida, sin ejecutarlo.
