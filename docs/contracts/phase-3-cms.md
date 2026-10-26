# Fase 3 — CMS tipo Shopify (contrato)

Reglas globales: las de las fases 1 y 2 (`docs/contracts/phase-1-identity.md`, `phase-2-catalog.md`): TS estricto sin `any`, Zod DTOs, `AppException`,
`TransactionService`, `AuditService.record(..., manager)` en cada escritura, `Clock`, `IdParamDto`, permisos por endpoint, sin tests.
Objetivo: que un ADMIN edite todo el contenido del sitio como en Shopify (Online Store 2.0): ajustes globales, menús, páginas, plantillas por secciones con
borrador → previsualizar → publicar / programar → historial → restaurar. El storefront solo lee lo PUBLICADO (o el borrador con token de preview).

## Modelo (una sola tabla de documentos versionados)
- `ContentDocument` (`content_documents`): kind varchar(20) (`settings|menu|template|page`), key varchar(120) (ej. `site`, `main`, `home`, `about`), title varchar(255) null,
  draft jsonb (siempre presente), publishedVersionId uuid null, draftUpdatedAt timestamptz(3), draftUpdatedBy uuid null, deletedAt (soft). Unique (kind, key) donde deletedAt IS NULL. `VersionedEntity`.
- `ContentVersion` (`content_versions`, append-only salvo `status`/`supersededAt`): documentId FK cascade, number int (secuencial por documento), data jsonb, status varchar(12)
  (`published|scheduled|superseded|cancelled`), publishAt timestamptz(3) null, publishedAt timestamptz(3) null, authorId uuid null, note varchar(255) null, createdAt. Unique (documentId, number). Índice parcial (status='scheduled', publishAt).
- `Redirect` (`redirects`): fromPath varchar(500) unique (normalizado: empieza por `/`, sin query, minúsculas, sin `/` final salvo raíz), toPath varchar(1000), statusCode smallint (301|302), isActive bool, hits int default 0. Sin bucles (from != to; rechazar cadena directa A→B con B→A).
- `Media` ya existe (fase 2): se amplía con storageKey varchar(255) null, byteSize int null, originalName varchar(255) null, sha256 char(64) null (índice), uploadedBy uuid null.

## Documentos por tipo (`data` validado con Zod al guardar el borrador; 400 con las rutas de los errores)
- `settings` / key `site`: `{ brand: { name, tagline?, logoMediaUrl? }, theme: { colors: { background, foreground, accent, ... hex #RRGGBB }, fonts: { heading, body } }, seo: { titleTemplate, defaultDescription, ogImageUrl? }, social: { instagram?, tiktok?, ... url }, announcement: { enabled, text, href? }, store: { currency: "COP", locale: "es-CO", contactEmail?, whatsapp? } }`.
- `menu` / keys `main`, `footer`, ...: `{ items: MenuItem[] }` con `MenuItem = { id, label, link: { type: "collection"|"product"|"page"|"url", handle?|url? }, children?: MenuItem[] }` (profundidad máx 3, ≤ 50 ítems en total). Los enlaces `url` solo `https://`, `/ruta` o `mailto:`/`tel:`.
- `template` / keys `home|collection|product|cart|search|404|page|layout` (`layout` = cabecera/boletín/pie globales): `{ sections: Section[] }` con `Section = { id, type, enabled, settings, blocks?: Block[] }` (≤ 40 secciones, ≤ 50 blocks por sección; ids únicos `^[a-z0-9-]{3,40}$`).
- `page` / key = handle: `{ title, handle, template: "page", seoTitle?, seoDescription?, sections: Section[] }` (el handle no cambia tras crearse: usar redirect).
- Tipos de sección (registro en código `src/cms/sections/registry.ts`, cada uno con schema Zod de `settings` y de `blocks`): `announcement-bar`, `hero`, `marquee`, `new-arrivals`, `split-banner`,
  `value-props`, `campaign`, `editorial`, `lookbook`, `newsletter`, `rich-text`, `footer`, y (ver `docs/CMS-SECTIONS.md`) `site-header`, `page-header`, `cta-banner`, `contact-form`, `collection-hero`, `product-grid`, `product-detail`, `search-panel`, `cart-drawer`, `error-hero`. Contenido por defecto sembrado con `yarn content:seed` / `SEED_DEFAULT_CONTENT`. Cada `settings` tiene textos con límites de longitud (≤ 300, ≤ 5000 para richtext), URLs de imagen validadas
  (`https://` o `/ruta`, sin `//`), colores hex, enums cerrados, referencias a colecciones/productos por handle. HTML: NO se acepta HTML crudo; richtext es Markdown limitado (el front lo renderiza).
  `GET /admin/content/section-types` devuelve `[{ type, label, settingsSchema (JSON Schema con z.toJSONSchema), blockTypes[] }]` para que el admin construya formularios.

## Admin (`/admin/content/...`; permisos `content:read` / `content:write` / `content:publish`)
- `GET /admin/content/documents?kind=` lista (kind, key, title, tiene borrador sin publicar, publishedAt, programado).
- `GET /admin/content/documents/:kind/:key` (borrador + resumen de versión publicada), `PUT` (upsert del borrador; `If-Match: <version>` o campo `version`; 409 `CONCURRENT_UPDATE`); crear `page` con `POST /admin/content/pages`; `DELETE` de page = soft delete (+ sugerir redirect).
- `POST .../publish` (`content:publish`) → crea ContentVersion `published`, marca la anterior `superseded`, actualiza publishedVersionId, auditoría, dispara revalidación del storefront.
- `POST .../schedule { publishAt }` (futuro, ≤ 1 año) crea versión `scheduled` (snapshot del borrador AHORA); `DELETE .../schedule/:versionId` la cancela. Un planificador in-process (cada 30 s; `SELECT ... FOR UPDATE SKIP LOCKED`, idempotente) promueve las vencidas usando `Clock`.
- `POST .../discard` (el borrador vuelve al contenido publicado), `GET .../versions` (paginado), `GET .../versions/:versionId`, `POST .../versions/:versionId/restore` (copia esa versión al BORRADOR, no publica).
- Preview: `POST /admin/content/preview-tokens { kind, key }` → `{ token, url }` JWT HS256 (`jose`, `PREVIEW_TOKEN_SECRET`; en dev secreto efímero como en TokenService) con exp 1 h y claim de documento; el storefront lo acepta en `?preview=`.
- Redirects: CRUD `/admin/redirects` (`content:write`), validaciones anteriores. Media: ver abajo.
- Cada publicación/edición se audita (diff resumido: claves cambiadas, no el contenido completo).

## Storefront público (`/storefront/content/...`, `@Public()`, `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, ETag débil por versión)
- `GET /storefront/content/settings` (site), `GET /storefront/content/menus/:key`, `GET /storefront/content/templates/:key`, `GET /storefront/content/pages/:handle`, `GET /storefront/content/pages` (handles+títulos publicados para sitemap), `GET /storefront/redirects` (lista activa para el middleware del front; cacheable).
- Con `?preview=<token>` válido para ese documento devuelve el BORRADOR con `Cache-Control: private, no-store`. Token inválido/expirado => 401 (no cae a publicado en silencio).
- Nunca exponer ids internos de usuarios, notas, ni versiones no publicadas.
- `GET /storefront/content/bundle?template=home` (opcional): settings + menús main/footer + template en una sola llamada (menos round-trips desde Next).

## Revalidación
Tras publicar/restaurar-publicar/promover programado: `POST {STOREFRONT_URL}/api/revalidate` con cuerpo `{ tags: ["content:<kind>:<key>"] }` y cabecera `x-signature: HMAC-SHA256(body, STOREFRONT_REVALIDATE_SECRET)`,
timeout 3 s, un reintento, NUNCA rompe la publicación (registrar advertencia). Deshabilitado si falta el secreto.

## Media (`/admin/media`, permisos `media:write` para escribir y `content:read` para listar)
- Interfaz `StorageDriver { put(key, buffer, mime): Promise<{ url }>; delete(key) }` con implementación `LocalDiskStorage` (carpeta `UPLOAD_DIR`, por defecto `./uploads`, servida en `GET /media/*` con `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, sin listado de directorio) y token de inyección para cambiar a S3/R2 después (NO implementar S3 ahora).
- `POST /admin/media` multipart (`multer` memoryStorage, límite 8 MB, 1 archivo), tipos permitidos por CONTENIDO real (magic bytes: png, jpeg, webp, avif, gif; NO svg): nombre generado `<uuid v7>.<ext>` (nunca usar el nombre del cliente en el path), dimensiones con `image-size`, sha256; si el sha256 ya existe devuelve la existente (200). Path traversal imposible por construcción.
- `GET /admin/media` (paginado, `q` por nombre/alt escapado), `PATCH /admin/media/:id` (alt), `GET /admin/media/:id/usages` (productos/colecciones/documentos que referencian la URL), `DELETE /admin/media/:id` (409 `MEDIA_IN_USE` si tiene usos, salvo `?force=true` con `media:write`).

## Propiedad de archivos
- **W1 (entidades + registro)** — `src/cms/entities/**`, `src/cms/sections/**`, `src/cms/schemas/**` (settings/menu/template/page Zod).
- **W2 (contenido)** — `src/cms/content/**` (service, controllers admin + storefront, scheduler, preview, revalidation), `src/cms/redirects/**`.
- **W3 (media)** — `src/cms/media/**`.
- Orquestador — `cms.module.ts`, `app.module.ts`, permisos, env, migración, smoke.

## Criterio de aceptación (smoke del orquestador)
Editar settings → publicar → `/storefront/content/settings` refleja; editar template home con sección inválida → 400 con ruta; borrador NO visible sin preview; con preview-token sí (y `no-store`);
programar en +2 s → tras el planificador pasa a publicado; restore de versión antigua; redirect creado y listado; subir PNG válido → URL servida por `/media/...` con nosniff; archivo `.png` que en realidad es texto → 415; analyst → 403 en publicar.
