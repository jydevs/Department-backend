# Department-backend — Plan de arquitectura y ejecución

Backend headless (NestJS + TypeORM + PostgreSQL) para **Daregular Dept.**, pensado para que la tienda sea **tan editable como en
Shopify**: catálogo, inventario, pedidos, clientes, descuentos, envíos **y también el contenido y el
diseño de la tienda** (secciones de la home, menús, páginas, ajustes del tema), todo administrado por
personal con roles y permisos.

> Estado: **plan aprobado** (decisiones en §10). Fase 0 en curso. ❓ = pendiente.

---

## 1. Principios

1. **Todo lo editable vive en la base de datos**, no en el código. Si en Shopify se cambia desde el
   admin, aquí también (productos, colecciones, menús, secciones, textos, imágenes, SEO, redirecciones).
2. **Dos superficies de API**: `/storefront/*` (pública, cacheable, sin permisos) y `/admin/*`
   (personal autenticado + RBAC + auditoría). Nunca se mezclan.
3. **Borrador → publicado** para todo el contenido (versiones, restaurar, programar, vista previa).
4. **Seguridad por defecto**: cada ruta admin declara su permiso; validación de entrada en el borde;
   secretos cifrados; auditoría de cambios; rate limiting.
5. **Migrable desde Shopify**: importador de productos / colecciones / clientes / pedidos y
   redirecciones 301 de las URLs antiguas.
6. **Colombia primero**: COP, IVA 19 % incluido, pasarela local, Habeas Data (Ley 1581),
   facturación electrónica DIAN como integración posterior.

## 2. Stack

| Capa | Elección |
| --- | --- |
| Framework | **NestJS 11** (monolito modular) + TypeScript estricto |
| BD | **PostgreSQL** (Neon / Supabase / Railway en prod). Dev sin Docker: `embedded-postgres` |
| ORM | **TypeORM** (entidades + migraciones versionadas; `synchronize` siempre apagado) |
| API | REST `/api/v1` + **OpenAPI** (`/docs`) → cliente TS generado para front y admin |
| Validación | **Zod** (DTOs y esquemas de secciones del CMS) |
| Auth | Staff: email + contraseña (**argon2id**) + refresh rotativo + 2FA TOTP opcional · Clientes: email + contraseña / enlace mágico · Integraciones: API keys con scopes |
| Archivos | S3 compatible (Cloudflare R2) con URL prefirmadas; disco local en dev |
| Jobs | Cola en Postgres (pg-boss) → emails, webhooks, importaciones, reservas de stock que expiran |
| Emails | Resend (o SMTP) con plantillas editables desde el admin |
| Pagos | Interfaz `PaymentProvider` + primer proveedor **Wompi** |
| Observabilidad | pino (JSON), request-id, `/health` y `/ready` |
| Deploy | Railway / Fly (API) + Neon (BD) + R2 (media) ❓ |

Repos: `Department-backend` (API), `Department-frontend` (tienda, consume `/storefront`),
`Department-admin` (panel de administración, consume `/admin`).

## 3. Módulos (NestJS)

```
common/        config(zod-env) · database(typeorm) · guards · pagination · errors · audit · queue · storage
identity/      staff · roles · api-keys · customers-auth · 2fa · sessions
catalog/       products · variants · options · media · collections · tags · metafields · search
inventory/     locations · levels · adjustments · reservations
content/       settings · menus · pages · templates · sections · versions · redirects · preview
commerce/      carts · checkout · discounts · shipping · taxes · orders · fulfillments · refunds · payments
customers/     profiles · addresses · orders history · GDPR
marketing/     newsletter · contact · email-templates · webhooks-out
analytics/     dashboard · reports
platform/      health · docs · import-shopify · jobs · settings (pagos, notificaciones)
```

## 4. Modelo de datos (resumen)

**Identidad**: `StaffUser`, `Role` (permisos como strings `recurso:accion`), `Session`, `ApiKey`,
`AuditLog`, `Customer`, `Address`, `PasswordReset`.

**Catálogo**: `Product` (handle, título, HTML/markdown, estado `draft|active|archived`, vendor, tipo,
SEO), `ProductOption` + `OptionValue` (ej. Talla), `Variant` (sku, precio, precio_comparado, peso,
código de barras, política de inventario), `Media`/`ProductMedia` (orden, alt), `Collection`
(`manual|smart` con reglas JSON), `CollectionProduct` (posición), `Tag`, **`Metafield`**
(ownerType/ownerId/namespace/key/type/value → campos personalizados como en Shopify).

**Inventario**: `Location`, `InventoryLevel` (variante × ubicación), `InventoryAdjustment`
(motivo, delta, autor), `StockReservation` (carritos/checkout con expiración).

**Contenido (equivalente a Online Store 2.0)**
- `SiteSettings` — clave/valor tipado: marca, tokens de diseño (colores, tipografías), SEO por defecto,
  redes sociales, barra de anuncios, moneda, idioma.
- `Menu` + `MenuItem` (árbol; enlaza a colección/producto/página/URL).
- `Page` (handle, título, plantilla, estado, SEO).
- `Template` (`home`, `collection`, `product`, `page:<handle>`) → lista ordenada de **`Section`**
  (`type`, `settings` JSON validado por Zod, `blocks[]`, `enabled`).
- `ContentVersion` (snapshot borrador/publicado, autor, fecha, programación) · `PreviewToken`.
- `Redirect` (301/302) · `Translation` (fase posterior).

**Comercio**: `Cart`/`CartLine`, `Checkout`, `Order`/`OrderLine`/`OrderAddress`, `Fulfillment`,
`Refund`, `Transaction`, `Discount` (código / automático; %, fijo, envío gratis, mínimo, límites,
fechas, colecciones), `DiscountRedemption`, `ShippingZone`/`ShippingRate`, `TaxRule`, `DraftOrder`,
`OrderEvent` (línea de tiempo).

**Marketing / plataforma**: `NewsletterSubscriber`, `ContactMessage`, `EmailTemplate`, `EmailLog`,
`WebhookEndpoint`/`WebhookDelivery`, `ImportJob`.

### Tipos de sección del CMS (v1, salen del diseño actual)
`announcement_bar`, `hero`, `marquee`, `collection_banner` (split), `product_grid`
(colección/selección manual, columnas), `image_banner` (new arrivals), `editorial` (imagen + texto +
CTA), `value_props`, `rich_text`, `gallery` (lookbook), `newsletter`, `custom_html` (solo Owner).
Cada tipo publica su **JSON Schema** en `GET /admin/content/section-types` para que el editor del
admin renderice formularios automáticamente y valide.

## 5. Roles y permisos

Permisos con forma `recurso:read|write|delete|publish`. Roles base (editables):

| Rol | Alcance |
| --- | --- |
| **Owner** | Todo, incluido personal, pagos, API keys, `custom_html`, exportar/borrar datos |
| **Admin** | Todo salvo gestión de Owners, secretos de pagos y facturación |
| **Editor** | Contenido (`content:*`), catálogo (`products:*`, `collections:*`, `media:*`); sin pedidos ni ajustes |
| **Fulfillment** | Pedidos (leer + despachar), inventario |
| **Support** | Pedidos y clientes (leer), reembolsos hasta un tope, notas |
| **Analyst** | Solo lectura + analítica |

Toda acción de escritura genera `AuditLog` (quién, qué, antes/después, IP).

## 6. Catálogo de endpoints

Prefijo `/api/v1`. **Auth**: `—` público · `C` cliente · `A:<permiso>` personal.

### 6.1 Storefront (público)
| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/storefront/settings` | — | Marca, tokens de diseño, SEO, redes, moneda |
| GET | `/storefront/menus/:handle` | — | Menú en árbol |
| GET | `/storefront/pages/:handle` | — | Página + secciones publicadas |
| GET | `/storefront/templates/:name` | — | Secciones resueltas (con productos incrustados) — home, colección, producto |
| GET | `/storefront/products` | — | Lista: `collection`, `q`, `availability`, `price_min/max`, `tag`, `sort`, `cursor`, `limit` |
| GET | `/storefront/products/:handle` | — | Ficha con variantes, stock, media, metafields |
| GET | `/storefront/products/:handle/recommendations` | — | Relacionados |
| GET | `/storefront/collections` · `/:handle` | — | Colecciones (con productos paginados) |
| GET | `/storefront/search` · `/search/suggest` | — | Búsqueda (FTS + trigram) |
| GET | `/storefront/redirects/resolve?path=` | — | Redirecciones para el middleware del front |
| POST | `/storefront/carts` | — | Crea carrito (cookie/token) |
| GET/PATCH | `/storefront/carts/:id` | — | Lee / actualiza nota, país |
| POST · PATCH · DELETE | `/storefront/carts/:id/lines[/:lineId]` | — | Líneas (valida stock y agotados) |
| POST · DELETE | `/storefront/carts/:id/discount-codes[/:code]` | — | Códigos |
| POST | `/storefront/checkouts` | — | Desde carrito |
| GET · PATCH | `/storefront/checkouts/:id` | — | Email, direcciones, notas |
| GET | `/storefront/checkouts/:id/shipping-rates` | — | Tarifas por zona |
| POST | `/storefront/checkouts/:id/shipping-rate` | — | Elige tarifa |
| POST | `/storefront/checkouts/:id/payment` | — | Inicia pago (redirect / widget) |
| POST | `/webhooks/payments/:provider` | firma | Confirmación de pago (idempotente) |
| POST | `/storefront/auth/register` · `/login` · `/logout` · `/refresh` | — | Cuenta de cliente |
| POST | `/storefront/auth/forgot-password` · `/reset-password` · `/magic-link` | — | Recuperación |
| GET · PATCH | `/storefront/customers/me` | C | Perfil |
| CRUD | `/storefront/customers/me/addresses` | C | Direcciones |
| GET | `/storefront/customers/me/orders[/:id]` | C | Historial |
| GET | `/storefront/orders/:token` | token | Estado de pedido invitado |
| POST | `/storefront/newsletter` | — | Suscripción (con consentimiento) |
| POST | `/storefront/contact` | — | Formulario de contacto |
| POST | `/storefront/customers/me/data-export` · `DELETE /customers/me` | C | Habeas Data |

### 6.2 Admin
| Grupo | Endpoints | Permiso |
| --- | --- | --- |
| **Auth** | `POST /admin/auth/login · refresh · logout · 2fa/setup · 2fa/verify · password` · `GET /admin/me` | — / sesión |
| **Personal y roles** | CRUD `/admin/staff` · `/admin/roles` · `GET /admin/permissions` · sesiones activas | `staff:*` |
| **API keys / webhooks** | CRUD `/admin/api-keys` · `/admin/webhooks` (+ `test`, `deliveries`) | `settings:write` |
| **Productos** | CRUD `/admin/products` · `POST /:id/duplicate · publish · archive` · CRUD `/:id/variants` · `/:id/options` · `PUT /:id/media` (orden) · `POST /bulk` · `GET/POST /export · /import` (CSV) | `products:*` |
| **Colecciones** | CRUD `/admin/collections` · `PUT /:id/products` (orden) · `POST /preview-rules` | `collections:*` |
| **Inventario** | `GET /admin/inventory` · `POST /adjust` · CRUD `/admin/locations` · `GET /adjustments` | `inventory:*` |
| **Media** | `POST /admin/media/uploads` (presign) · `POST /:id/confirm` · `GET` · `PATCH` (alt) · `DELETE` · `GET /:id/usages` | `media:*` |
| **Contenido** | `GET/PUT /admin/content/settings` · CRUD `/admin/menus` · CRUD `/admin/pages` · `GET/PUT /admin/content/templates/:name` (borrador) · `POST /…/publish · schedule · discard` · `GET /…/versions` · `POST /…/versions/:id/restore` · `POST /admin/content/preview-tokens` · `GET /admin/content/section-types` · CRUD `/admin/redirects` · CRUD `/admin/metafield-definitions` | `content:*` (`content:publish`) |
| **Pedidos** | `GET /admin/orders` (filtros/búsqueda) · `GET/PATCH /:id` · `POST /:id/fulfillments · refunds · cancel · mark-paid · resend-confirmation · notes` · `GET /:id/timeline` · CRUD `/admin/draft-orders` + `POST /:id/complete` | `orders:*` |
| **Clientes** | CRUD `/admin/customers` · `GET /export` · `POST /:id/erase` (GDPR) · notas/etiquetas | `customers:*` |
| **Descuentos** | CRUD `/admin/discounts` · `GET /:id/redemptions` | `discounts:*` |
| **Envíos e impuestos** | CRUD `/admin/shipping/zones` · `/rates` · `GET/PUT /admin/taxes` | `shipping:*` |
| **Marketing** | `GET /admin/newsletter` (+ export, baja) · `GET/PATCH /admin/contact-messages` · CRUD `/admin/email-templates` (+ `preview`, `test-send`) | `marketing:*` |
| **Analítica** | `GET /admin/analytics/overview · sales · top-products · customers` | `analytics:read` |
| **Ajustes** | `GET/PUT /admin/settings/store · checkout · payments (secretos cifrados) · notifications` | `settings:*` |
| **Auditoría** | `GET /admin/audit-log` | `audit:read` |
| **Importación** | `POST /admin/import/shopify` · `GET /admin/import/jobs[/:id]` | `import:*` |
| **Sistema** | `GET /health · /ready · /version` · `GET /docs` (OpenAPI) | — |

## 7. Integración con el front (`Department-frontend`)

- `src/data/products.ts` y `src/lib/cart.ts` se reemplazan por un **cliente `/storefront`** con
  `fetch` + tags de caché de Next; al **publicar** algo, el backend llama a un webhook
  (`revalidateTag`) → la tienda se actualiza sin redeploy.
- La **home deja de ser JSX fijo**: `page.tsx` pide `templates/home` y renderiza cada sección con un
  **registro** `type → componente` (`Hero`, `MarqueeBand`, `NewArrivals`, `SplitBanner`, …). Los
  componentes actuales pasan a leer sus textos, imágenes, enlaces y colores de `settings`.
- Tokens de diseño (colores/tipografías) desde `settings` → variables CSS.
- **Vista previa**: `?preview=<token>` activa modo borrador (`draftMode`).
- El carrito pasa a ser **servidor** (id en cookie) con actualización optimista.

## 8. Fases (por partes, un PR por parte)

| # | Parte | Entregable |
| --- | --- | --- |
| 0 | **Fundación** | Scaffold Nest, TypeORM, config validada, errores/paginación, OpenAPI, health, CI, BD dev embebida, seed con el catálogo y contenido actuales |
| 1 | **Identidad y accesos** | Staff, roles/permisos, sesiones, 2FA, API keys, auditoría, auth de clientes |
| 2 | **Catálogo e inventario** | Productos/variantes/opciones/media/colecciones/metafields, búsqueda, endpoints storefront + admin |
| 3 | **Contenido (CMS)** | Ajustes, menús, páginas, plantillas/secciones, versiones, publicar/programar, vista previa, redirecciones |
| 4 | **Carrito, checkout y pedidos** | Carritos, descuentos, envíos, impuestos, pedidos (máquina de estados), reservas de stock, pagos + webhook, emails |
| 5 | **Clientes y marketing** | Perfil/direcciones, newsletter, contacto, plantillas de email, Habeas Data, webhooks salientes |
| 6 | **Integración del front** | Cliente API, secciones dinámicas, carrito servidor, revalidación, preview |
| 7 | **Admin UI** | `Department-admin`: panel, productos, pedidos, clientes, **editor visual de secciones**, media, ajustes, personal |
| 8 | **Importador Shopify + endurecimiento** | Importación + redirecciones 301, rate limits, revisión de seguridad, backups, despliegue |

Orden de dependencias: `0 → 1 → (2 ∥ 3) → 4 → 5 → 6 → 7 → 8` (el importador se puede adelantar
para probar con datos reales).

## 9. Cómo trabajan los agentes

```
Orquestador (yo)   escribe el CONTRATO del módulo: entidades TypeORM, DTOs/Zod, endpoints, permisos,
      │            criterios de aceptación y archivos que el módulo posee
      ▼
Escritor (haiku)   implementa UN módulo en su propio worktree/rama; no toca archivos compartidos;
      │            commits pequeños en español
      ▼
Auditor (opus)     revisa el diff contra el contrato + checklist (abajo) → lista de hallazgos
      │            con severidad; nada se abre a PR con hallazgos críticos/altos
      ▼
Escritor (haiku)   corrige hallazgos
      ▼
Orquestador        typecheck + lint + build + arranque + smoke del módulo → PR → tú apruebas
```

**Checklist del auditor** (todas las rutas): permiso declarado y aplicado · validación Zod en el
borde · IDOR (¿el recurso pertenece a quien lo pide?) · transacciones y concurrencia en dinero/stock ·
idempotencia de webhooks · N+1 y paginación · datos personales fuera de logs · secretos no expuestos ·
mass-assignment · rate limiting en auth/checkout · consistencia de estados de pedido.

Reglas de git iguales que en el front: una rama por parte, commits pequeños, **nada a `main` sin tu
aprobación**. Los módulos independientes (p. ej. 2 y 3) se escriben en paralelo tras la Fundación.

## 10. Decisiones (resueltas)

| # | Decisión | Elegido |
| --- | --- | --- |
| 1 | Stack | **NestJS + TypeORM + PostgreSQL** |
| 2 | Pasarela de pago | **Wompi** (detrás de `PaymentProvider`, intercambiable) |
| 3 | Panel admin | **App separada `Department-admin`** |
| 4 | Pruebas | **Smoke scripts + auditor Opus** (sin suites; revisión reforzada en dinero/stock/pagos) |
| 5 | Hosting | ❓ pendiente (se necesita solo para desplegar: Neon/Supabase, Railway/Fly, R2) |

## 11. Fuera de alcance de la primera versión

Multi-moneda / multi-idioma, marketplace o apps de terceros, facturación electrónica DIAN
(se deja el gancho `invoice` en pedidos), tarjetas de regalo, suscripciones, POS.
