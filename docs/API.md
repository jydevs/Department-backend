# Guía de integración de la API

Para el equipo del front (`Department-frontend`) y del panel admin (`Department-admin`). La fuente de verdad de los
esquemas es OpenAPI: `GET /docs-json` (Swagger UI en `/docs`, activo salvo en producción) o `docs/openapi.json`
(`API_URL=… node scripts/export-openapi.mjs`). Genera de ahí el cliente TypeScript.

## 1. URL base y prefijos

| Prefijo | Qué es |
| --- | --- |
| `/api/v1/storefront/*` | Superficie pública de la tienda (cacheable, sin permisos; cliente con su propio Bearer donde se indica) |
| `/api/v1/admin/*` | Panel: personal autenticado + permisos + auditoría |
| `/api/v1/auth/*` | Autenticación del personal |
| `/health` · `/ready` · `/version` | Operación, **sin** prefijo |
| `/media/:key` | Archivos subidos, **sin** prefijo (público, inmutable, cache 1 año) |
| `/webhooks/wompi` | Webhook de pagos, **sin** prefijo |
| `/docs` · `/docs-json` | OpenAPI (solo si `DOCS_ENABLED`) |

Local: `http://localhost:4000`. Todo el cuerpo es JSON (`Content-Type: application/json`, límite 1 MB); las subidas son `multipart/form-data`.
CORS: solo los orígenes de `CORS_ORIGINS`, con `credentials: true`. Cabeceras permitidas desde el navegador:
`Content-Type, Authorization, X-Request-Id, Idempotency-Key, If-Match, X-Cart-Token, X-Quote-Email`. Expuestas: `X-Request-Id, Retry-After, ETag`.

## 2. Autenticación

### Personal (panel admin)
1. `POST /api/v1/auth/login` con `{ email, password, totp? }` (5/min por IP). Devuelve `{ accessToken, expiresIn, user }`
   y fija la cookie **`dept_rt`** (httpOnly, `SameSite=Lax`, `Secure` en producción, `Path=/api/v1/auth`, 30 días).
2. Envía `Authorization: Bearer <accessToken>` en cada llamada `/admin/*`.
3. Cuando expire (`expiresIn` en segundos) o llegue un 401: `POST /api/v1/auth/refresh` (con `credentials: "include"`; la cookie se rota y se devuelve un nuevo `accessToken`). Reutilizar un refresh ya rotado revoca la familia, salvo durante 20 s tras la rotación (dos pestañas / reintento concurrente): en esa gracia se devuelve solo un `accessToken` nuevo, **sin** `Set-Cookie` (se conserva la cookie que dejó la petición ganadora) y la familia sigue viva.
4. `POST /api/v1/auth/logout` revoca las sesiones. `GET /api/v1/auth/me` devuelve rol y **lista de permisos**: el panel debe usarla para mostrar/ocultar secciones (el servidor siempre lo vuelve a comprobar).
5. 2FA TOTP opcional: `POST /auth/2fa/setup` → `/auth/2fa/enable` → `/auth/2fa/disable`; `POST /auth/change-password`.

Como la cookie tiene `Path=/api/v1/auth`, el navegador solo la envía a esas rutas. Panel y API deben ser mismo sitio (mismo dominio registrable) para `SameSite=Lax`.

### Clientes (tienda)
- `POST /storefront/customers/register` (5/min) → correo de verificación. `POST /storefront/customers/verify-email` `{ token, password }`.
- `POST /storefront/customers/login` (5/min) → `{ accessToken, expiresIn (15 min), refreshToken omitido, customer }`; cookie **`dept_ct`** (httpOnly, `Path=/api/v1/storefront/customers`, 30 días).
- `POST /storefront/customers/refresh` rota la cookie y devuelve un nuevo `accessToken` (misma gracia de 20 s para peticiones concurrentes: sin `Set-Cookie` ni revocación); `POST /storefront/customers/logout`.
- `forgot-password` (3/min) y `reset-password` (10/min).
- `POST /storefront/customers/auth/resend-verification` `{ email }` (3/min, alias `/storefront/customers/resend-verification`) → siempre **202** `{ message }` idéntico exista o no la cuenta. Solo encola el correo `email_verify` si la cuenta existe, está activa y **no verificada**; no emite otro enlace si hay uno sin usar de menos de 2 min (el anterior se invalida al emitir uno nuevo). Email inválido → 400.
- Rutas `/storefront/customers/me/*` exigen `Authorization: Bearer <accessToken del cliente>`. El token del cliente es distinto del del personal y no sirve en `/admin`.
- Como el refresh es una cookie, el refresh se hace desde el navegador (o el servidor Next reenviando la cookie). Guarda el `accessToken` solo en memoria.

### Permisos por rol
Formato `recurso:accion`. Un endpoint admin exige **todos** los permisos listados en su fila (sección 9).

| Rol | Permisos |
| --- | --- |
| owner | todos |
| admin | todos salvo `roles:write` (incluye `orders:payments` y `orders:refunds`) |
| editor | `content:read/write/publish`, `media:write`, `products:read/write`, `collections:read/write`, `inventory:read` |
| fulfillment | `orders:read/write` (sin `orders:payments` ni `orders:refunds`), `inventory:read/write`, `shipping:read` |
| support | `orders:read`, `customers:read`, `marketing:read` |
| analyst | `staff:read`, `roles:read`, `audit:read`, `products:read`, `collections:read`, `inventory:read`, `orders:read`, `customers:read`, `content:read`, `analytics:read`, `discounts:read`, `shipping:read`, `marketing:read` |

Lista completa: `staff:*`, `roles:*`, `audit:read`, `settings:read|write`, `products:*`, `collections:*`, `inventory:*`, `orders:read|write|payments|refunds` (`payments` = marcar pagado a mano, `refunds` = reembolsos: solo owner/admin por defecto; los roles personalizados con `orders:write` NO los reciben automáticamente), `customers:*`,
`content:read|write|publish`, `media:write`, `discounts:*`, `shipping:*`, `marketing:*`, `import:read|write`, `analytics:read`.
Sin token → 401 `UNAUTHORIZED`; con token pero sin permiso → 403 `FORBIDDEN`.

## 3. Paginación

- **Offset** (tablas del admin y listados de cuenta): query `page` (≥1, máx. 1000) y `pageSize` (1-100, por defecto 25). Respuesta:
  `{ items, total, page, pageSize, totalPages }`.
- **Cursor** (feeds de la tienda y registro de auditoría): query `limit` (1-100, por defecto 24) y `cursor` (opaco). Respuesta:
  `{ items, nextCursor, hasMore }`. Pasa `nextCursor` tal cual; un cursor malformado devuelve 400.

Cada endpoint indica en OpenAPI cuál de los dos usa; los filtros específicos (`q`, `sort`, `status`…) están en su esquema.

## 4. Errores

Cuerpo uniforme para cualquier fallo (nunca incluye trazas ni SQL):

```json
{ "statusCode": 409, "error": "Conflict", "code": "CONCURRENT_UPDATE", "message": "…", "details": null, "requestId": "…" }
```

| Estado | Códigos típicos |
| --- | --- |
| 400 | `VALIDATION_ERROR` (con `details` por campo, Zod), `BAD_REQUEST`, `CART_TOKEN_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`, `VERSION_REQUIRED`, `PREVIEW_NOT_SUPPORTED` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `CONCURRENT_UPDATE` (reintentar), `IDEMPOTENCY_IN_PROGRESS`, `ALREADY_ANONYMIZED` y otros de dominio |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `IDEMPOTENCY_KEY_REUSED` y reglas de negocio |
| 429 | `RATE_LIMITED` (respeta `Retry-After`) |
| 500 / 503 | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` |

Muestra `message` al usuario solo si tu UI lo necesita; ramifica siempre por `code`. Guarda `requestId` para soporte (coincide con la cabecera `X-Request-Id` de la respuesta y con los logs).

## 5. Idempotencia y concurrencia

- **`POST /storefront/checkouts` exige `Idempotency-Key`** (8-120 caracteres visibles, p. ej. un UUID generado al abrir el checkout). Repetir la misma petición con la misma clave devuelve la misma respuesta, **incluido el mismo `accessToken`** (ya no se rota: el token de la primera respuesta sigue siendo válido; las filas antiguas, anteriores a este cambio, siguen rotándolo); la misma clave con otro cuerpo da 422 `IDEMPOTENCY_KEY_REUSED`; mientras se procesa, 409 `IDEMPOTENCY_IN_PROGRESS`. Las claves se conservan 7 días.
- **Bloqueo optimista**: los documentos de contenido y varias entidades llevan `version`. Envía `If-Match: "3"` (o `version` en el cuerpo) al hacer `PUT`; si cambió, 409 `CONCURRENT_UPDATE`/conflicto: recarga y reaplica.
- Los webhooks de pago son idempotentes (se descartan eventos ya procesados; la tabla se purga a los 90 días).

## 6. Cabeceras clave

| Cabecera | Uso |
| --- | --- |
| `Authorization: Bearer …` | Token de acceso (personal en `/admin`; cliente en `/storefront/customers/me`) |
| `X-Cart-Token` | **Obligatoria** en `GET/POST/PATCH/PUT/DELETE /storefront/carts/:id…`. Se recibe **una sola vez** al crear el carrito (`POST /storefront/carts` → `{ id, token, … }`); guárdalo (cookie httpOnly en el servidor Next o almacenamiento del navegador). Sin él: 400 `CART_TOKEN_REQUIRED` |
| `Idempotency-Key` | Ver sección 5 (checkout) |
| `If-Match` / `ETag` | Bloqueo optimista en contenido; `ETag`/`If-None-Match` en lecturas de contenido de la tienda (304) |
| `X-Request-Id` | Opcional al enviar (8-100 caracteres `A-Za-z0-9._-`); si no, el servidor genera uno. Siempre se devuelve |
| `X-Storefront-Key` + `X-Visitor-Ip` | Solo el **servidor** Next (nunca el navegador): `X-Storefront-Key` = `STOREFRONT_SERVER_KEY`; con ella el servidor puede indicar la IP real del visitante en `X-Visitor-Ip` para que el rate limit cuente por visitante y no por el host de Next. Sin la clave correcta, `X-Visitor-Ip` se ignora |
| `Retry-After` | En 429 |

## 7. Webhooks, vista previa y revalidación

### Wompi (instrucciones de pago y conciliación)
`PaymentInstructions` (checkout y `GET /storefront/orders/:n`) añade `expirationTime?: string` (ISO-8601, = `reservedUntil` del pedido) **solo si el backend tiene `WOMPI_EXPIRATION_ENABLED=true`**. En ese caso `signatureIntegrity = sha256(reference + amountInCents + currency + expirationTime + WOMPI_INTEGRITY_SECRET)` y el front **debe** añadir `expiration-time=<expirationTime>` a la URL del Web Checkout / widget (si no, Wompi rechaza la firma). Sin el flag la firma es la de siempre (`reference + amountInCents + currency + secret`) y no hay `expirationTime`.
Los eventos `PENDING` se guardan en `payments` y un pedido con transacción pendiente reciente (30 min) no se expira. Antes de actuar sobre un estado final, el webhook se contrasta con `GET {WOMPI_API_URL}/transactions/{id}`; además un job (1/min) concilia con la API los pedidos `pending` a punto de expirar o con transacción pendiente. Sin llaves Wompi (mock) nada de esto se ejecuta. `POST /storefront/dev/mock-payment` acepta también `status: "pending"` (solo dev).

### Wompi (entrante)
`POST /webhooks/wompi` (sin prefijo, sin sesión, sin rate limit). La autenticidad sale de la firma (checksum) calculada con `WOMPI_EVENTS_SECRET`
sobre el **cuerpo crudo**; una firma inválida se rechaza. Configura esa URL en el panel de Wompi. Responde `200 { received: true }`.
En desarrollo, con `MOCK_PAYMENTS_ENABLED=true` y `PAYMENT_PROVIDER=mock`, `POST /storefront/dev/mock-payment { reference, status }` simula el evento (en producción responde 404).

### Vista previa de contenido
1. El admin (permiso `content:read`) pide `POST /admin/content/preview-tokens` con el documento (`kind` + `key`). Devuelve `{ token, url, expiresAt }`; el token vive 1 h y es válido para **un solo documento**. `url` apunta a `{STOREFRONT_URL}/api/preview?token=…`.
2. El front implementa `/api/preview`: activa `draftMode` y guarda el token.
3. En modo borrador, el front pide `GET /storefront/content/{settings|menus/:key|templates/:key|pages/:key}?preview=<token>` (sin `Cache-Control` público). `/storefront/content/bundle` **no** admite `preview`.

### Revalidación (saliente: la API llama al front)
Además del contenido, tras el COMMIT de cualquier cambio de catálogo (productos, variantes, opciones, medios, metafields, colecciones y sus productos, ajustes/reservas/commit/restock de inventario y cambios de ubicaciones) la API envía `catalog`, `catalog:product:<handle>` y `catalog:collection:<handle>` (agrupadas y sin duplicados por transacción; las colecciones manuales que contienen el producto también se avisan; sin `STOREFRONT_REVALIDATE_SECRET` no hace nada). Los handles cumplen `[a-z0-9-]+`.
Tras publicar/programar/restaurar contenido, la API hace `POST {STOREFRONT_URL}/api/revalidate` (2 intentos, timeout 3 s, nunca bloquea la publicación). **El front debe implementar esa ruta**:

- Cuerpo JSON (texto exacto): `{ "tags": ["…"], "ts": 1712345678901 }` (`ts` en ms epoch, va dentro del cuerpo firmado).
- Cabecera `x-signature` = HMAC-SHA256 en hexadecimal del **cuerpo crudo** con `STOREFRONT_REVALIDATE_SECRET` (el mismo valor en API y front).
- El front debe: (1) leer el cuerpo **crudo** (`await req.text()`), (2) recalcular el HMAC y comparar en tiempo constante (`crypto.timingSafeEqual`), (3) rechazar si `|Date.now() - ts|` supera ~5 minutos (anti-replay), (4) validar que `tags` sea un arreglo de cadenas cortas, (5) llamar `revalidateTag` por cada etiqueta y responder 200. Cualquier fallo → 401 sin detalles.

```ts
// app/api/revalidate/route.ts (referencia)
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-signature") ?? "";
  const expected = createHmac("sha256", process.env.STOREFRONT_REVALIDATE_SECRET!).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response(null, { status: 401 });
  const { tags, ts } = JSON.parse(raw) as { tags: unknown; ts: unknown };
  if (typeof ts !== "number" || Math.abs(Date.now() - ts) > 5 * 60_000) return new Response(null, { status: 401 });
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || t.length > 100)) return new Response(null, { status: 400 });
  for (const t of tags) revalidateTag(t);
  return Response.json({ ok: true });
}
```

## 8. Media

- Subida: `POST /admin/media` (`multipart/form-data`, campo `file`, permiso `media:write`, máx. 8 MB, imágenes png/jpeg/webp/avif/gif; se valida el contenido real, no solo la extensión). 201 si es nueva, 200 si ya existía (deduplicado por contenido).
- Servicio: `GET /media/:key` (fuera de `/api/v1`), con `Cache-Control: public, max-age=31536000, immutable` y `Cross-Origin-Resource-Policy: cross-origin`. Las URLs ya vienen completas en las respuestas (`PUBLIC_URL`).
- Los CSV de importación se guardan en `UPLOAD_DIR/imports` y **nunca** se sirven por `/media`.

## 9. Límites de rate

Global por IP (o por visitante con `X-Storefront-Key`): `THROTTLE_LIMIT` (120) por `THROTTLE_TTL_MS` (60 s). Más estrictos:

| Ruta | Límite / min |
| --- | --- |
| `POST /auth/login`, `POST /storefront/customers/login`, `/register`, `me/change-password`, `DELETE me` | 5 |
| `forgot-password`, `resend-verification`, `me/data-export`, `POST /storefront/contact` | 3 |
| `reset-password`, `verify-email` | 10 |
| `POST /storefront/newsletter` | 5; confirm/unsubscribe 10 |
| `POST /storefront/checkouts` | 10 |
| `POST /storefront/carts` | 60; el resto de `/storefront/carts/*` 120 |
| `GET /storefront/orders/:orderNumber` | 60 |
| `POST /admin/email-templates/:key/test-send` | 5 |
| `POST /admin/maintenance/run` | 2 |
| `/webhooks/wompi` | sin límite |

Los límites se cuentan en memoria **por instancia**: con varias instancias el límite efectivo es múltiplo (ver README).

## 10. Endpoints por grupo

Prefijo `/api/v1` salvo donde se indica. Auth: `—` público · `C` Bearer de cliente · `A:<permiso>` personal.
Tabla generada del código (`@Controller`/`@Get`/`@Post`…); ante duda manda `/docs-json`.

### Operación (sin prefijo)
| Método | Ruta | Auth |
| --- | --- | --- |
| GET | `/health` · `/ready` (verifica BD) · `/version` | — |
| GET | `/media/:key` | — |
| POST | `/webhooks/wompi` | firma |

### Auth del personal
| Método | Ruta | Auth |
| --- | --- | --- |
| POST | `/auth/login` · `/auth/refresh` (cookie) | — |
| POST | `/auth/logout` · `/auth/2fa/setup` · `/auth/2fa/enable` · `/auth/2fa/disable` · `/auth/change-password` | personal |
| GET | `/auth/me` | personal |

### Personal y roles
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/staff` · `/admin/staff/:id` | A:staff:read |
| POST · PATCH · DELETE | `/admin/staff` · `/admin/staff/:id` | A:staff:write |
| GET | `/admin/roles` | A:roles:read |
| GET | `/admin/audit-logs` (cursor; filtros `entityType`, `actorId`) | A:audit:read |

### Catálogo (admin)
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/products` · `/admin/products/facets` · `/admin/products/:id` · `/admin/products/:id/metafields` | A:products:read |
| POST | `/admin/products` · `/bulk` · `/:id/duplicate` · `/:id/publish` · `/:id/archive` · `/:id/variants` | A:products:write |
| PATCH · DELETE | `/admin/products/:id` · `/admin/products/:id/variants/:variantId` | A:products:write |
| PUT | `/admin/products/:id/options` · `/:id/media` · `/:id/metafields` | A:products:write |
| DELETE | `/admin/products/:id/metafields/:namespace/:key` (404 si no existe; auditado) | A:products:write |
| GET | `/admin/collections` · `/:id` · `/:id/products` · `/:id/metafields` | A:collections:read |
| POST | `/admin/collections` · `/admin/collections/preview-rules` | A:collections:write |
| PATCH · DELETE | `/admin/collections/:id` | A:collections:write |
| PUT | `/admin/collections/:id/products` · `/:id/metafields` | A:collections:write |
| DELETE | `/admin/collections/:id/metafields/:namespace/:key` (404 si no existe; auditado) | A:collections:write |
| GET | `/admin/inventory` · `/admin/inventory/adjustments` · `/admin/locations` · `/admin/locations/:id` | A:inventory:read |
| POST | `/admin/inventory/adjust` · `/admin/locations` | A:inventory:write |
| PATCH · DELETE | `/admin/locations/:id` | A:inventory:write |

#### Ampliaciones del panel (catálogo e inventario)
- **Variantes**: cada variante de `GET /admin/products/:id` y de las respuestas de crear/actualizar incluye `version` (la exige `PATCH /admin/products/:id/variants/:variantId`).
- **Inventario**: los items de `GET /admin/inventory` y `GET /admin/inventory/adjustments` (y la respuesta de `POST /admin/inventory/adjust`) añaden `productId`, `productTitle`, `productHandle` (anulables), resueltos con JOIN.
- **Colecciones**: `CollectionDto` añade `image: { url, alt, width, height } | null` (resuelta desde `imageMediaId`) y `version`. `PATCH /admin/collections/:id` acepta `version` opcional: si difiere de la guardada → 409 `CONCURRENT_UPDATE`. `GET /admin/collections/:id/products` → `{ items: [{ id, handle, title, status, position, image, minPrice }], total }` en orden, con borradores y archivados; colección smart → 409 `COLLECTION_NOT_MANUAL`.
- **Facetas**: `GET /admin/products/facets` → `{ tags, vendors, productTypes }` (distintos de productos no borrados, máx. 500 cada uno, ordenados).
- **Crear producto**: el cuerpo admite `defaultVariantPrice` (entero COP ≥ 0, se aplica a las variantes generadas desde `options`) y, en `variants[]`, `optionValues: string[]` (nombres de valor en el orden de `options`; se enlazan a los ids creados en la misma transacción; combinación repetida o valor inexistente → 400; no combinar con `optionValueIds`).
- **Inventario (filtros)**: `GET /admin/inventory` acepta además `variantId` y `productId` (uuid; se combinan con `q`, `locationId`, `lowStock`).
- **Pedidos**: `POST /admin/orders/:id/mark-paid` con una `reference` ya usada por otro pago → 409 `PAYMENT_REFERENCE_DUPLICATE`.
- **Imágenes (contenido)**: fuera de `production`, `safeImageUrl` acepta además `http://localhost`, `http://127.0.0.1` y `http://[::1]` con puerto opcional; en producción sigue exigiendo `https://` o `/ruta`.

### Catálogo (tienda)
| Método | Ruta | Auth |
| --- | --- | --- |
| GET | `/storefront/products` · `/storefront/products/:handle` | — |
| GET | `/storefront/collections` · `/storefront/collections/:handle` | — |
| GET | `/storefront/search` | — |

Ampliaciones (aditivas) del resumen de producto de `GET /storefront/products`, `GET /storefront/collections/:handle` (`products.items`) y `GET /storefront/search`:
`compareAtPrice` (mínimo `compare_at_price` de variantes activas con precio comparado > precio, o `null`), `hoverImage` (segunda imagen por posición o `null`), `tags`, `vendor`, `updatedAt` (ISO-8601, última modificación del producto) y `variants: [{ id, title, price, compareAtPrice, available, options: [{ name, value }] }]` (solo activas, máx. 100). Se calculan con consultas en lote (sin N+1).
`total` (productos que cumplen el filtro, sin contar el cursor) llega en `GET /storefront/products` y en `products.total` de la colección. Filtro `available=true|false` en ambos (producto disponible = alguna variante disponible con la regla de `available`). El `Cache-Control` público no cambia.

### Contenido / CMS
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/content/section-types` · `/documents` · `/documents/:kind/:key` · `/documents/:kind/:key/versions` · `/…/versions/:versionId` | A:content:read |
| POST | `/admin/content/preview-tokens` | A:content:read |
| POST | `/admin/content/pages` · `/documents/:kind/:key/discard` · `/documents/:kind/:key/versions/:versionId/restore` | A:content:write |
| PUT | `/admin/content/documents/:kind/:key` | A:content:write |
| POST | `/admin/content/documents/:kind/:key/publish` · `/schedule` | A:content:publish |
| DELETE | `/admin/content/documents/:kind/:key` (borra una página: la quita de la tienda) | A:content:publish (antes `content:write`) |
| DELETE | `/admin/content/documents/:kind/:key/schedule/:versionId` | A:content:publish |
| GET | `/admin/media` · `/admin/media/:id/usages` · `/admin/redirects` · `/admin/redirects/:id` | A:content:read |
| POST · PATCH · DELETE | `/admin/redirects[/:id]` | A:content:write |
| POST · PATCH · DELETE | `/admin/media` (multipart) · `/admin/media/:id` | A:media:write |
| GET | `/storefront/content/settings` · `/menus/:key` · `/templates/:key` · `/pages` · `/pages/:key` · `/bundle` | — |
| GET | `/storefront/redirects` | — |

### Carrito, checkout y pedidos (tienda)
| Método | Ruta | Auth |
| --- | --- | --- |
| POST | `/storefront/carts` | — |
| GET | `/storefront/carts/:id` | X-Cart-Token |
| POST | `/storefront/carts/:id/lines` | X-Cart-Token |
| PATCH · DELETE | `/storefront/carts/:id/lines/:variantId` | X-Cart-Token |
| PUT | `/storefront/carts/:id/discount` | X-Cart-Token |
| DELETE | `/storefront/carts/:id` | X-Cart-Token |
| GET | `/storefront/shipping-rates?department=&cartId=` | **X-Cart-Token** (del carrito `cartId`; sin él 400 `CART_TOKEN_REQUIRED`, con otro token 404) |
| POST | `/storefront/checkouts` | Idempotency-Key |
| GET | `/storefront/orders/:orderNumber?token=…` (token del pedido) | token |
| POST | `/storefront/dev/mock-payment` (solo dev/CI) | — |

#### Carrito y pedido público: campos añadidos (todos compatibles hacia atrás)
- **`GET /storefront/carts/:id?shippingRateId=&department=&email=`** (X-Cart-Token): `shippingRateId` y `department` van **juntos** (uno solo → 400). Con ellos el `quote` incluye `shippingTotal`, `shippingRate { id, name }` y el IVA recalculado sobre subtotal − descuento + envío (envío gratis por umbral o por código `free_shipping` incluido). Tarifa inexistente/no disponible para el departamento → 422 `SHIPPING_RATE_INVALID`. Sin esos parámetros todo queda como antes (`shippingTotal: 0`). `email` (opcional) valida los códigos de un solo uso por email al cotizar; también se acepta por la cabecera **`X-Quote-Email`** (para no poner el email en la URL; si vienen ambos gana el query; email mal formado en la cabecera → 400 `VALIDATION_ERROR`). El valor no se registra en los logs (cabecera redactada, la query string nunca se loguea). Las mutaciones (`POST/PATCH/DELETE …/lines`, `PUT …/discount`) siguen devolviendo el carrito sin envío.
- **`quote`** (carrito y checkout) añade: `taxIncluded` (boolean: los precios ya incluyen IVA; `total` no suma `taxTotal`), `taxRatePercent` (number, p. ej. 19) y `taxBreakdown { label, ratePercent, netAmount, taxAmount }` (`netAmount` = base sin IVA; `taxAmount` = `taxTotal`). Cada línea añade `productHandle` (string | null).
- **`CartResponse`** añade `converted` (boolean) y `convertedOrderNumber` (number | null). Un carrito ya pagado/convertido sigue respondiendo `GET` (con `converted: true`); las mutaciones siguen dando 409 `CART_CONVERTED`.
- **`PUT /storefront/carts/:id/discount`** acepta `email` opcional junto a `code`: si el código es de un solo uso por email y ese email (sin distinguir mayúsculas) ya lo usó → 422 `DISCOUNT_INVALID` con `details.reason: "already_used"` antes de pagar. Sin `email` el comportamiento es el de siempre (se valida al pagar).
- **Pedidos con sesión iniciada**: `POST /storefront/checkouts` acepta opcionalmente `Authorization: Bearer <accessToken del cliente>` (el front debe enviarlo cuando haya sesión). Si el token es válido y el email del checkout es el email **verificado** de la cuenta, el pedido se asocia al cliente (`customer_id`) y aparece en `GET /storefront/customers/me/orders`; un token inválido o un email distinto se ignora y el pedido queda como invitado. Además, cada `POST /storefront/customers/refresh` asocia los pedidos de invitado del email verificado.
- **Enlaces de correo**: los correos de pedido (confirmación, envío, cancelación, reembolso) llevan `{STOREFRONT_URL}/orders/{n}?token=…`. Ese token (hasheado en BD, tabla `order_access_tokens`, caduca a los 90 días) abre **solo ese pedido** en `GET /storefront/orders/:orderNumber?token=` con los mismos permisos que el token del checkout (lectura y reintento de pago). Cada correo genera su propio token. El front debe leer `?token=` en `/orders/[n]` y reenviarlo tal cual a la API.
- **`GET /storefront/orders/:orderNumber?token=`**: cada línea añade `variantId`, `productId` y `productHandle` (string | null). `payment` añade `instructions` (mismo objeto `PaymentInstructions` que devuelve `POST /storefront/checkouts`) **solo mientras el pedido está `pending`** (también tras un pago `declined`/`error`); en otro estado es `null`. Permite reintentar el pago desde otro navegador solo con el token del pedido.

### Pedidos, descuentos, envíos, impuestos (admin)
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/orders` · `/:id` · `/:id/timeline` | A:orders:read |
| PATCH | `/admin/orders/:id` | A:orders:write |
| POST | `/admin/orders/:id/notes` · `/cancel` · `/fulfillments` · `/fulfillments/:fid/cancel` | A:orders:write |
| POST | `/admin/orders/:id/mark-paid` | A:orders:payments (solo owner/admin por defecto) |
| POST | `/admin/orders/:id/refunds` | A:orders:refunds (solo owner/admin por defecto) |
| GET | `/admin/discounts` · `/:id` · `/:id/redemptions` | A:discounts:read |
| POST · PATCH · DELETE | `/admin/discounts[/:id]` | A:discounts:write |
| GET | `/admin/shipping/zones[/:id]` · `/admin/shipping/rates[/:id]` · `/admin/taxes` | A:shipping:read |
| POST · PATCH · DELETE | `/admin/shipping/zones[/:id]` · `/admin/shipping/rates[/:id]` | A:shipping:write |
| PUT | `/admin/taxes` | A:settings:write |

### Clientes (tienda)
| Método | Ruta | Auth |
| --- | --- | --- |
| POST | `/storefront/customers/auth/resend-verification` | — |
| POST | `/storefront/customers/register` · `/login` · `/refresh` (cookie) · `/logout` · `/forgot-password` · `/reset-password` · `/verify-email` | — |
| GET · PATCH | `/storefront/customers/me` | C |
| POST | `/storefront/customers/me/change-password` · `/me/data-export` | C |
| DELETE | `/storefront/customers/me` (Habeas Data: anonimiza) | C |
| GET | `/storefront/customers/me/orders` · `/me/orders/:orderNumber` | C |
| GET · POST | `/storefront/customers/me/addresses` | C |
| PATCH · DELETE | `/storefront/customers/me/addresses/:addressId` | C |

`GET …/me/orders/:orderNumber` devuelve lo mismo que el pedido público y más: por línea `variantId`, `productId` y `productHandle` (handle actual, `null` si el producto ya no existe); `payment { provider, status, method, instructions }` donde `instructions` (PaymentInstructions) solo viene con el pedido `pending` y del proveedor activo (mismas reglas que `GET /storefront/orders/:n`), y `reservedUntil` (solo `pending`, si no `null`). `GET …/me/orders` (listado) no cambia.

`PATCH …/addresses/:addressId`: `documentType` y `documentNumber` aceptan `null` (o `""` en el número) para **quitar el documento**; quitar solo `documentType` limpia también el número salvo que se envíe uno nuevo. El mínimo de 4 caracteres de `documentNumber` solo se exige cuando se envía un valor.

### Clientes (admin) y marketing
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/customers` · `/admin/customers/:id` | A:customers:read |
| GET · PATCH · POST | `/admin/customers/export` · `/admin/customers/:id` · `/admin/customers/:id/erase` | A:customers:write |
| GET | `/admin/contact-messages` · `/admin/newsletter` · `/admin/email-templates` · `/admin/email-templates/:key` | A:marketing:read |
| PATCH · DELETE | `/admin/contact-messages/:id` | A:marketing:write |
| GET | `/admin/newsletter/export` | A:marketing:write |
| POST | `/admin/newsletter/:id/unsubscribe` · `/admin/email-templates/:key/preview` · `/:key/test-send` | A:marketing:write |
| PUT | `/admin/email-templates/:key` | A:marketing:write |
| POST | `/storefront/newsletter` · `/storefront/newsletter/confirm?token=` · `/storefront/newsletter/unsubscribe?token=` · `/storefront/contact` (acepta `phone` opcional: 7–20 dígitos, `+` inicial opcional; 400 si está mal formado; se devuelve en `GET /admin/contact-messages`) | — |
| GET | `/storefront/newsletter/confirm` (**deprecated**: cambia estado por GET; usar el POST) · `/storefront/newsletter/unsubscribe` (solo valida el token: 200 `{ status: "valid" }` o 400 `INVALID_TOKEN`; ya **no** da de baja, la baja es el POST) | — |

### Analítica y mantenimiento
| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/admin/analytics/overview` · `/sales` · `/top-products` · `/customers` | A:analytics:read |
| POST | `/admin/maintenance/run` (una pasada de mantenimiento; devuelve el resumen por tarea) | A:settings:write |

### Importador Shopify (CSV)
| Método | Ruta | Permiso |
| --- | --- | --- |
| POST | `/admin/import/jobs` (multipart: `file` = .csv, `type` = `products`|`customers`, `dryRun` opcional; responde 202 con el job `queued`) | A:import:write |
| GET | `/admin/import/jobs` (lista) · `/admin/import/jobs/:id` (progreso, contadores y errores por fila) | A:import:read |
| POST | `/admin/import/jobs/:id/cancel` | A:import:write |

Límites: CSV UTF-8 (RFC 4180 estricto) de hasta 10 MB, 5000 filas, 64 columnas y 100 000 caracteres por celda. El CSV se borra al terminar el job. `dryRun` ejecuta todo y hace rollback.
Semántica:
- **Productos**: se agrupan por `Handle`. Solo las columnas PRESENTES en el archivo actualizan un campo; una columna ausente conserva el valor guardado (una celda vacía sí lo borra). Sin `Status`/`Published` un producto existente conserva su estado. `Body (HTML)` se sanea con la lista blanca del servidor.
- **Clientes**: se crean como invitados sin contraseña ni email verificado. Con `Accepts Email Marketing=yes` solo se consiente en clientes NUEVOS (y solo cuenta cuando verifican el email); un cliente existente nunca cambia su consentimiento. Filas con código `ACCOUNT_UNVERIFIED_SKIPPED` (cuenta con contraseña y email sin verificar: no se le fusionan datos personales) o `SUPPRESSED` (titular cuya supresión Habeas Data se registró) se saltan y se reportan como error de fila.
- `descriptionHtml` de productos y colecciones (API admin e importador) se guarda ya saneado con la misma lista blanca (`p, br, strong, em, ul, ol, li, h2-h4, a[https|mailto|tel], img[https]`).

### Supresión (Habeas Data)
Al anonimizar un cliente se guarda el sha256 del email normalizado en `erasure_suppressions`. El importador salta esas direcciones y `POST /storefront/customers/register` responde 202 sin crear nada ni revelar el motivo. Limitación: el propio titular no puede volver a registrarse hasta que el personal elimine su fila (`DELETE FROM erasure_suppressions WHERE email_hash = encode(sha256(convert_to('<email>','UTF8')),'hex')`); no hay endpoint de administración para ello todavía.

### Mantenimiento
`POST /admin/maintenance/run` (`settings:write`, 2/min, auditado) ejecuta la misma pasada horaria; solo una instancia a la vez (lock de sesión de Postgres). Los permisos de los roles de sistema se sincronizan con el código en cada arranque.
