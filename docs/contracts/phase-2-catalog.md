# Fase 2 — Catálogo e inventario (contrato)

Mismas reglas globales que la Fase 1 (`docs/contracts/phase-1-identity.md`): TS estricto sin `any`, Zod DTOs (`createZodDto`), `AppException`, entidades con `AppBaseEntity`/`VersionedEntity`,
`TransactionService` para todo lo multi-tabla, `AuditService.record(..., manager)` en cada escritura admin, `Clock`, `IdParamDto`/`HandleParamDto`, paginación de `src/common/pagination`.
Sin tests. Endpoints admin: `/admin/...` + `@RequirePermissions`. Endpoints públicos: `/storefront/...` + `@Public()`.
Dinero: `bigint` COP con `moneyTransformer` (`src/common/money/money.ts`), nunca float. Los DTO de respuesta se mapean explícitamente (no devolver entidades).
Estado de producto: `draft | active | archived`. Handles: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, únicos, generados desde el título si no vienen (sufijo `-2`, `-3` si chocan).
Imágenes: por ahora `Media` guarda una URL (la subida S3/R2 llega en otra fase); el front sigue sirviendo `/public`.

## Propiedad de archivos
- **A** — `src/catalog/entities/**` (+ `index.ts`), `src/inventory/entities/**`
- **B** — `src/catalog/products/**`
- **C** — `src/catalog/collections/**`, `src/catalog/storefront/**`
- **D** — `src/inventory/**` (salvo `entities/`), `src/catalog/metafields/**`
- Orquestador — `catalog.module.ts`, `inventory.module.ts`, `app.module.ts`, `permissions.ts`, migración, smoke.

## Entidades (A)
Todas snake_case por la naming strategy; ids uuid v7 (AppBaseEntity). `@JoinColumn({ name: "xxx_id" })` siempre con el nombre snake_case real de la columna FK, y la columna explícita `xxxId` con `@Column({ type: "uuid" })` (sin duplicar columnas). Exportar desde `index.ts` de su carpeta.
- `Product`: handle (unique, varchar 120), title, descriptionHtml text default '', status varchar(12) default `draft`, vendor null, productType null, tags `text[]` default `{}` (índice GIN), seoTitle null, seoDescription null, publishedAt timestamptz(3) null, `deletedAt` (soft delete). Extiende `VersionedEntity`. Índices: status, (status, publishedAt), GIN(tags).
- `ProductOption`: productId FK cascade, name, position int. `ProductOptionValue`: optionId FK cascade, value, position int. Unique (productId,name) y (optionId,value).
- `Variant`: productId FK cascade, sku null (unique parcial donde no es null), title, price bigint (moneyTransformer, CHECK price >= 0), compareAtPrice bigint null, weightGrams int null, barcode null, position int, trackInventory bool default true, allowBackorder bool default false, `optionValueIds` uuid[] default `{}`, isActive bool default true. Extiende `VersionedEntity`.
- `Media`: url text, alt text null, width/height int null, mimeType null. (id uuid, AppBaseEntity)
- `ProductMedia`: productId FK cascade, mediaId FK cascade, variantId uuid null, position int. Unique (productId, mediaId). AppBaseEntity.
- `Collection`: handle unique, title, descriptionHtml text default '', type varchar(8) `manual|smart`, rules jsonb null (`{ match: "all"|"any", conditions: [{ field: "tag"|"vendor"|"type"|"price", op: "eq"|"neq"|"gt"|"lt"|"contains", value: string|number }] }`), sortOrder varchar(12) `manual|title|newest|price_asc|price_desc` default manual, isPublished bool default false, seoTitle/seoDescription null, imageMediaId uuid null, deletedAt soft delete. `CollectionProduct`: collectionId FK cascade, productId FK cascade, position int, unique (collectionId, productId); AppBaseEntity.
- `Metafield`: ownerType varchar(30), ownerId uuid, namespace varchar(60), key varchar(60), type varchar(30) (`single_line_text|multi_line_text|number_integer|number_decimal|boolean|json|url|color`), value text. Unique (ownerType, ownerId, namespace, key). Índice (ownerType, ownerId).
- `Location`: name, isDefault bool default false, isActive bool default true. Índice único parcial: solo una fila con `isDefault = true`. VersionedEntity.
- `InventoryLevel`: variantId FK cascade, locationId FK, onHand int default 0, reserved int default 0, CHECK (onHand >= 0), CHECK (reserved >= 0 AND reserved <= onHand), unique (variantId, locationId). VersionedEntity.
- `InventoryAdjustment` (append-only, sin updatedAt; mismo patrón que `src/identity/entities/audit-log.entity.ts`): variantId, locationId, delta int, reason varchar(20) (`received|correction|sold|returned|damaged|restock|other`), note null, actorId uuid null, createdAt. Índice (variantId, createdAt).

## Permisos
El orquestador añade `collections:read|write`, `inventory:read|write` a `PERMISSIONS`/`ROLE_DEFAULTS` (editor: collections+products+inventory:read; fulfillment: inventory read/write; analyst: read).

## Productos admin (B) — `/admin/products`
- `GET` (`products:read`): página `PageQueryDto` + filtros `status`, `q` (ILIKE título/sku/handle, con escape de `%`/`_`), `tag`, `vendor`; devuelve resumen (id, handle, title, status, imagen principal, `variantCount`, `inventoryTotal`, precio mínimo/máximo).
- `POST` (`products:write`): crea producto con `options` y `variants` opcionales en UNA transacción (si hay opciones y no se envían variantes, generarlas del producto cartesiano; máx 100 variantes). `GET :id` detalle completo. `PATCH :id` (con `version` → 409 `CONCURRENT_UPDATE` si no coincide). `DELETE :id` = soft delete.
- `POST :id/duplicate` (copia como draft, handle nuevo), `POST :id/publish` (exige ≥1 variante activa con precio; fija publishedAt), `POST :id/archive`.
- Variantes: `POST/PATCH/DELETE :id/variants[/:variantId]` (sku duplicado → 409 `SKU_TAKEN`). Opciones: `PUT :id/options` (reemplaza árbol de opciones/valores y reconcilia variantes; rechazar si borra valores usados salvo `force`).
- Media: `PUT :id/media` reemplaza la lista ordenada `[{ url, alt, variantId? }]` (reutiliza `Media` por URL si ya existe).
- `POST /admin/products/bulk` `{ ids[≤100], action: "publish"|"archive"|"delete"|"add_tags"|"remove_tags", tags? }`.
- Cada escritura → `AuditService.record` (action `product:create|update|publish|...`, diff con campos cambiados).

## Colecciones y storefront (C)
- Admin `/admin/collections` (`collections:read|write`): CRUD; `PUT :id/products` orden manual `[{productId}]`; `POST /admin/collections/preview-rules` evalúa reglas smart y devuelve hasta 24 productos + total. Las colecciones smart se resuelven en consulta (no materializadas), con las reglas traducidas a SQL parametrizado (NUNCA concatenar valores; campos y operadores en lista blanca).
- Storefront (todo `@Public()`, solo `active` y no borrados, sin datos internos):
  - `GET /storefront/products` — cursor (`CursorQueryDto`), filtros `collection` (handle), `tag`, `q`, `sort` (`newest|price_asc|price_desc|title`); cursor `{k, id}` con desempate por id.
  - `GET /storefront/products/:handle` — producto + opciones + variantes (con `available: boolean` calculado desde inventario y política de backorder, NO el conteo exacto) + media + metafields públicos (namespace `custom`) + `seo`.
  - `GET /storefront/collections`, `GET /storefront/collections/:handle` (+ productos paginados por cursor).
  - `GET /storefront/search?q=` — máx 24 productos y colecciones, ILIKE con escape de `%`/`_`, `q` mínimo 2 caracteres.
  - `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` en lecturas de catálogo.

## Inventario y metafields (D)
- `/admin/locations` CRUD (`inventory:*`; no borrar/desactivar la última activa ni la default con stock).
- `GET /admin/inventory` (variante × ubicación, filtros `q`, `locationId`, `lowStock`), `POST /admin/inventory/adjust` `{ variantId, locationId, delta | setTo, reason, note }` en transacción con `SELECT … FOR UPDATE` sobre el nivel (crear si no existe), rechazar `onHand` negativo (409 `INSUFFICIENT_STOCK`), registrar `InventoryAdjustment` + auditoría. `GET /admin/inventory/adjustments` (cursor, filtro variantId).
- `InventoryService` exportado para la Fase 4: `availableFor(variantIds): Map<id, number>`, `reserve(items, manager)` / `release(...)` / `commit(...)` (implementación con `UPDATE … WHERE on_hand - reserved >= :qty` verificando filas afectadas).
- Metafields: `GET/PUT /admin/metafields/:ownerType/:ownerId` (`products:write` para owner `product`, `collections:write` para `collection`), upsert por (namespace,key) validando `type` vs `value`; solo el namespace `custom` es público.

## Criterio de aceptación
`yarn typecheck && lint && build` limpios; migración generada; el orquestador amplía el smoke: crear producto con variantes → publicar → aparece en `/storefront/products` y `/:handle` → ajustar stock → `available` cambia → colección smart por tag lo incluye → analyst no puede escribir (403).
