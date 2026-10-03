# Backend y base de datos local — documentación

Estado a 3 de octubre de 2026. Describe lo que hay en el entorno de desarrollo local: el backend (`Department-backend`) y su PostgreSQL local.

> **Seguridad:** este documento NO contiene credenciales. Los valores reales (usuario/contraseña de la base, correo y contraseña del owner) viven solo en el `.env` local de cada desarrollador (está en `.gitignore`) y en el gestor de secretos del entorno. Nunca se suben al repositorio.

## 1. Resumen
- **Backend:** API en NestJS 11 + TypeORM + PostgreSQL, TypeScript estricto, validación con Zod, OpenAPI. Rama `main` con las Fases 0–8 mergeadas (PRs #1–#8).
- **Base de datos local:** PostgreSQL 18 como servicio (`postgresql-x64-18` en Windows), puerto **5432**, base **`department`** (UTF8) con 47 tablas.
- **API en desarrollo:** `http://localhost:4000` conectada a esa base (`/health`, `/ready`, `/docs`).

## 2. Conexión a la base de datos (solo desarrollo local)
| Dato | Valor |
| --- | --- |
| Host / puerto | `localhost` / `5432` |
| Base | `department` |
| Usuario / contraseña | definidos en tu `.env` local (`DATABASE_URL`) |
| URL (plantilla) | `postgres://<usuario>:<contraseña>@localhost:5432/department` |
| SSL | desactivado en local (`DATABASE_SSL=disable`); **obligatorio en producción** |

- El backend la lee de `Department-backend/.env` (`DATABASE_URL`), ignorado por git.
- Cliente gráfico (pgAdmin, DBeaver, TablePlus) con esos datos; por consola: `psql -h localhost -U <usuario> -d department`.
- Usa una contraseña fuerte y única aunque sea local, y **no expongas el puerto 5432** fuera de tu máquina. En producción: credenciales propias, red privada y SSL.

## 3. Datos cargados en la base local
| Qué | Cantidad |
| --- | --- |
| Productos (todos publicados) | 9, con 36 variantes (tallas S/M/L/XL), 9 opciones, 23 imágenes (rutas `/images/...` del front) |
| Colecciones | 3: `all` (9 productos), `men` (6), `women` (2) |
| Inventario | 1 ubicación ("Bogotá"), 10 unidades por variante (32 niveles; `out-of-stock-product` queda en 0 a propósito) |
| Contenido del sitio (CMS) | 12 documentos publicados: `settings/site`, `menu/main`, `menu/footer`, `template/home\|collection\|product\|search\|cart\|404\|layout`, `page/community`, `page/contact` |
| Plantillas de correo | 9 (confirmación, envío, cancelación, reembolso, reset, verificación, bienvenida, newsletter, cuenta existente) |
| Roles | 6: owner (30 permisos), admin (29), editor (9), fulfillment (5), support (3), analyst (13) |
| Personal | 1 usuario owner (creado con `yarn owner:create`) |
| Pedidos, clientes, descuentos, envíos, mensajes | 0 (vacío) |

El catálogo demo también siembra el contenido del sitio (12 documentos del CMS) porque el script arranca la aplicación completa. Es idempotente: no pisa lo que se edite a mano.

## 4. Cómo manejar el backend
```bash
cd Department-backend
yarn install                       # solo la primera vez
yarn build                         # compila a dist/
node dist/main.js                  # arranca la API en :4000 (health: /health, listo: /ready, docs: /docs)
yarn migration:run                 # aplica migraciones pendientes a la base del .env
yarn owner:create                  # (OWNER_EMAIL y OWNER_PASSWORD en el entorno) crea/asegura el owner
yarn smoke                         # prueba E2E de toda la API (OWNER_EMAIL/OWNER_PASSWORD en el entorno; reinicia la API entre corridas: el login limita 5/min)
yarn lint && yarn typecheck        # calidad
```
- Migraciones aplicadas (7): Identity, Catalog, Cms, Commerce, Customers, Imports, Suppressions.
- Datos demo (rama `feature/content-seed`, aún sin PR/merge): `yarn catalog:seed` y `yarn content:seed`.
- El `.env` de desarrollo usa `PAYMENT_PROVIDER=mock` y correo en modo `log` (los correos solo se guardan en `email_outbox`, no se envían).

## 5. Qué hace el backend (por áreas)
- **Seguridad/identidad:** login del personal con argon2id, bloqueo tras 5 fallos, 2FA TOTP con códigos de recuperación, refresh por cookie con rotación, 6 roles con permisos `recurso:accion`, auditoría de cada cambio (`audit_logs`).
- **Catálogo e inventario:** productos, variantes, opciones, colecciones (manuales e inteligentes), metafields, stock por ubicación con reservas.
- **CMS:** ajustes del sitio y tema, menús, plantillas con secciones, páginas, borrador → publicar/programar/restaurar versiones, biblioteca de medios (subida validada por contenido real), redirecciones.
- **Comercio:** carrito con token, checkout idempotente que reserva stock 30 min, pagos Wompi (+ proveedor `mock` de desarrollo), pedidos, envíos con tracking, reembolsos, descuentos, tarifas por zona, IVA 19 % incluido.
- **Clientes y marketing:** cuentas, correo transaccional con cola, newsletter con doble opt-in, formulario de contacto, analítica de ventas, importador de Shopify por CSV, mantenimiento programado.
- Detalle: `docs/API.md` (guía + ~130 endpoints), `docs/openapi.json`, `docs/PLAN.md`, `docs/contracts/*`, `docs/SECURITY-REVIEW.md`.

## 6. Diccionario de datos (tablas de la base local)
Lectura: `columna:tipo` ; `?` = admite nulo; `→` = clave foránea. Los ids son uuid v7; todas las tablas tienen `created_at/updated_at` salvo las de solo anexar (`audit_logs`, `order_events`, `inventory_adjustments`).

### Identidad y auditoría (personal del panel)
**`staff_users`** — Columnas: `id:uuid`, `created_at:timestamptz`, `updated_at:timestamptz`, `version:integer`, `email:varchar(255)`, `password_hash:text`, `full_name:varchar(255)`, `is_active:boolean`, `role_id:uuid`, `totp_secret_enc:text?`, `totp_enabled:boolean`, `recovery_codes_hash:ARRAY`, `failed_login_count:integer`, `locked_until:timestamptz?`, `last_login_at:timestamptz?`. Relaciones: `role_id→roles`.

**`roles`** — `id:uuid`, `created_at`, `updated_at`, `key:varchar(40)`, `name:varchar(255)`, `permissions:ARRAY`, `is_system:boolean`.

**`refresh_tokens`** — `id:uuid`, `created_at`, `updated_at`, `staff_user_id:uuid`, `family_id:uuid`, `token_hash:character(64)`, `expires_at:timestamptz`, `revoked_at:timestamptz?`, `replaced_by_id:uuid?`, `user_agent:varchar(300)?`, `ip:varchar(45)?`. Relaciones: `staff_user_id→staff_users`.

**`audit_logs`** (solo anexar) — `id:uuid`, `actor_type:varchar(20)`, `actor_id:uuid?`, `action:varchar(80)`, `entity_type:varchar(60)`, `entity_id:varchar(64)?`, `diff:jsonb?`, `request_id:varchar(100)?`, `ip:varchar(45)?`, `created_at:timestamptz`.

### Catálogo
**`products`** — `id`, `created_at`, `updated_at`, `version:integer`, `handle:varchar(120)`, `title:varchar(255)`, `description_html:text`, `status:varchar(12)`, `vendor:varchar(255)?`, `product_type:varchar(255)?`, `tags:ARRAY`, `seo_title:varchar(255)?`, `seo_description:text?`, `published_at:timestamptz?`, `deleted_at:timestamptz?`.

**`product_options`** — `id`, `created_at`, `updated_at`, `product_id:uuid`, `name:varchar(255)`, `position:integer`. →`products`.

**`product_option_values`** — `id`, `created_at`, `updated_at`, `option_id:uuid`, `value:varchar(255)`, `position:integer`. →`product_options`.

**`variants`** — `id`, `created_at`, `updated_at`, `version`, `product_id:uuid`, `sku:varchar(120)?`, `title:varchar(255)`, `price:bigint`, `compare_at_price:bigint?`, `weight_grams:integer?`, `barcode:varchar(120)?`, `position:integer`, `track_inventory:boolean`, `allow_backorder:boolean`, `option_value_ids:ARRAY`, `is_active:boolean`. →`products`.

**`media`** — `id`, `created_at`, `updated_at`, `url:text`, `alt:text?`, `width:integer?`, `height:integer?`, `mime_type:varchar(100)?`, `storage_key:varchar(255)?`, `byte_size:integer?`, `original_name:varchar(255)?`, `sha256:character(64)?`, `uploaded_by:uuid?`.

**`product_media`** — `id`, `created_at`, `updated_at`, `product_id:uuid`, `media_id:uuid`, `variant_id:uuid?`, `position:integer`. →`products`, `media`.

**`collections`** — `id`, `created_at`, `updated_at`, `handle:varchar(120)`, `title:varchar(255)`, `description_html:text`, `type:varchar(8)`, `rules:jsonb?`, `sort_order:varchar(12)`, `is_published:boolean`, `seo_title:varchar(255)?`, `seo_description:text?`, `image_media_id:uuid?`, `deleted_at:timestamptz?`.

**`collection_products`** — `id`, `created_at`, `updated_at`, `collection_id:uuid`, `product_id:uuid`, `position:integer`. →`collections`, `products`.

**`metafields`** — `id`, `created_at`, `updated_at`, `owner_type:varchar(30)`, `owner_id:uuid`, `namespace:varchar(60)`, `key:varchar(60)`, `type:varchar(30)`, `value:text`.

### Inventario
**`locations`** — `id`, `created_at`, `updated_at`, `version`, `name:varchar(255)`, `is_default:boolean`, `is_active:boolean`.

**`inventory_levels`** — `id`, `created_at`, `updated_at`, `version`, `variant_id:uuid`, `location_id:uuid`, `on_hand:integer`, `reserved:integer`. →`variants`, `locations`.

**`inventory_adjustments`** (solo anexar) — `id`, `variant_id:uuid`, `location_id:uuid`, `delta:integer`, `reason:varchar(20)`, `note:text?`, `actor_id:uuid?`, `created_at`.

### Contenido del sitio (CMS)
**`content_documents`** — `id`, `created_at`, `updated_at`, `version`, `kind:varchar(20)`, `key:varchar(120)`, `title:varchar(255)?`, `draft:jsonb`, `published_version_id:uuid?`, `draft_updated_at:timestamptz`, `draft_updated_by:uuid?`, `deleted_at:timestamptz?`. →`content_versions` (`published_version_id`).

**`content_versions`** — `id`, `document_id:uuid`, `number:integer`, `title:varchar(255)?`, `data:jsonb`, `status:varchar(12)`, `publish_at:timestamptz?`, `published_at:timestamptz?`, `superseded_at:timestamptz?`, `author_id:uuid?`, `note:varchar(255)?`, `created_at`. →`content_documents`.

**`redirects`** — `id`, `created_at`, `updated_at`, `from_path:varchar(500)`, `to_path:varchar(1000)`, `status_code:smallint`, `is_active:boolean`.

### Carrito, pedidos y pagos
**`carts`** — `id`, `created_at`, `updated_at`, `token_hash:character(64)`, `currency:varchar(3)`, `discount_code:varchar(40)?`, `expires_at:timestamptz`, `converted_order_id:uuid?`.

**`cart_lines`** — `id`, `created_at`, `updated_at`, `cart_id:uuid`, `variant_id:uuid`, `quantity:integer`. →`carts`, `variants`.

**`orders`** — `id`, `created_at`, `updated_at`, `version`, `order_number:integer`, `access_token_hash:character(64)`, `email:varchar(255)`, `phone:varchar(30)?`, `status:varchar(20)`, `payment_status:varchar(20)`, `fulfillment_status:varchar(20)`, `currency:varchar(3)`, `subtotal`, `discount_total`, `shipping_total`, `tax_total`, `total`, `total_refunded` (todos `bigint`), `discount_code:varchar(40)?`, `shipping_rate_name:varchar(120)?`, `shipping_address:jsonb`, `billing_address:jsonb?`, `customer_note:varchar(500)?`, `internal_note:text?`, `tags:ARRAY`, `reserved_until:timestamptz?`, `paid_at:timestamptz?`, `cancelled_at:timestamptz?`, `cancel_reason:varchar(255)?`, `customer_id:uuid?`, `payment_provider:varchar(20)`, `payment_reference:varchar(80)`, `idempotency_key_id:uuid?`.

**`order_lines`** — `id`, `created_at`, `updated_at`, `order_id:uuid`, `variant_id:uuid`, `product_id:uuid`, `sku:varchar(120)?`, `title:varchar(255)`, `variant_title:varchar(255)`, `image_url:varchar(2000)?`, `unit_price:bigint`, `quantity:integer`, `line_total:bigint`, `fulfilled_quantity:integer`, `refunded_quantity:integer`, `reserved_quantity:integer`. →`orders`.

**`order_events`** (solo anexar) — `id`, `order_id:uuid`, `type:varchar(40)`, `data:jsonb`, `actor_type:varchar(20)`, `actor_id:uuid?`, `created_at`. →`orders`.

**`payments`** — `id`, `created_at`, `updated_at`, `order_id:uuid`, `provider:varchar(20)`, `provider_transaction_id:varchar(80)?`, `reference:varchar(80)`, `amount:bigint`, `currency:varchar(3)`, `status:varchar(20)`, `raw_status:varchar(40)?`, `method:varchar(30)?`. →`orders`.

**`fulfillments`** — `id`, `created_at`, `updated_at`, `order_id:uuid`, `status:varchar(20)`, `carrier:varchar(80)?`, `tracking_number:varchar(120)?`, `tracking_url:varchar(500)?`, `shipped_at:timestamptz`. →`orders`.

**`fulfillment_lines`** — `id`, `created_at`, `updated_at`, `fulfillment_id:uuid`, `order_line_id:uuid`, `quantity:integer`. →`fulfillments`, `order_lines`.

**`refunds`** — `id`, `created_at`, `updated_at`, `order_id:uuid`, `amount:bigint`, `reason:varchar(255)?`, `restocked:boolean`, `provider_status:varchar(20)`, `actor_id:uuid?`. →`orders`.

**`refund_lines`** — `id`, `created_at`, `updated_at`, `refund_id:uuid`, `order_line_id:uuid`, `quantity:integer`. →`refunds`, `order_lines`.

**`idempotency_keys`** — `id`, `created_at`, `updated_at`, `scope:varchar(40)`, `key:varchar(120)`, `request_hash:character(64)`, `status:varchar(12)`, `response_status:integer?`, `response:jsonb?`.

**`processed_events`** — `id`, `created_at`, `updated_at`, `provider:varchar(20)`, `event_id:varchar(120)`, `processed_at:timestamptz`.

### Descuentos, envíos e impuestos
**`discounts`** — `id`, `created_at`, `updated_at`, `code:varchar(40)`, `title:varchar(120)`, `type:varchar(15)`, `value:integer`, `min_subtotal:bigint?`, `starts_at:timestamptz`, `ends_at:timestamptz?`, `usage_limit:integer?`, `used_count:integer`, `once_per_email:boolean`, `is_active:boolean`.

**`discount_redemptions`** — `id`, `created_at`, `updated_at`, `discount_id:uuid`, `order_id:uuid`, `email:varchar(255)`, `amount:bigint`. →`discounts`, `orders`.

**`shipping_zones`** — `id`, `created_at`, `updated_at`, `name:varchar(120)`, `departments:ARRAY`, `is_active:boolean`.

**`shipping_rates`** — `id`, `created_at`, `updated_at`, `zone_id:uuid`, `name:varchar(120)`, `price:bigint`, `free_over_subtotal:bigint?`, `min_days:integer?`, `max_days:integer?`, `is_active:boolean`, `position:integer`. →`shipping_zones`.

**`tax_settings`** — `id`, `created_at`, `updated_at`, `prices_include_tax:boolean`, `rate_percent:numeric`, `label:varchar(40)`.

### Clientes
**`customers`** — `id`, `created_at`, `updated_at`, `version`, `email:varchar(255)`, `password_hash:text?`, `first_name:varchar(120)`, `last_name:varchar(120)`, `phone:varchar(30)?`, `accepts_marketing:boolean`, `marketing_consent_at:timestamptz?`, `is_active:boolean`, `email_verified_at:timestamptz?`, `failed_login_count:integer`, `locked_until:timestamptz?`, `last_login_at:timestamptz?`, `tags:ARRAY`, `internal_note:text?`, `anonymized_at:timestamptz?`, `deleted_at:timestamptz?`.

**`customer_addresses`** — `id`, `created_at`, `updated_at`, `customer_id:uuid`, `label:varchar(40)?`, `is_default:boolean`, `full_name:varchar(120)`, `phone:varchar(30)`, `department:varchar(60)`, `city:varchar(80)`, `address1:varchar(200)`, `address2:varchar(200)?`, `postal_code:varchar(12)?`, `document_type:varchar(4)?`, `document_number:varchar(20)?`. →`customers`.

**`customer_refresh_tokens`** — `id`, `created_at`, `updated_at`, `customer_id:uuid`, `family_id:uuid`, `token_hash:character(64)`, `expires_at:timestamptz`, `revoked_at:timestamptz?`, `replaced_by_id:uuid?`, `user_agent:varchar(300)?`, `ip:varchar(45)?`. →`customers`.

**`customer_tokens`** — `id`, `created_at`, `updated_at`, `customer_id:uuid`, `type:varchar(20)`, `token_hash:character(64)`, `expires_at:timestamptz`, `used_at:timestamptz?`. →`customers`.

**`erasure_suppressions`** — `id`, `email_hash:character(64)`, `created_at`.

### Correo y marketing
**`email_outbox`** — `id`, `created_at`, `updated_at`, `to:varchar(255)`, `template:varchar(60)`, `subject:varchar(255)`, `body_html:text`, `body_text:text`, `status:varchar(20)`, `attempts:integer`, `last_error:text?`, `send_after:timestamptz`, `sent_at:timestamptz?`.

**`email_templates`** — `id`, `created_at`, `updated_at`, `key:varchar(60)`, `subject:varchar(255)`, `body_html:text`, `body_text:text`, `is_active:boolean`.

**`newsletter_subscribers`** — `id`, `created_at`, `updated_at`, `email:varchar(255)`, `status:varchar(20)`, `source:varchar(40)`, `consent_at:timestamptz?`, `confirm_token_hash:character(64)?`, `unsubscribe_token_hash:character(64)?`, `ip:varchar(45)?`.

**`contact_messages`** — `id`, `created_at`, `updated_at`, `name:varchar(120)`, `email:varchar(255)`, `subject:varchar(200)?`, `message:varchar(4000)`, `status:varchar(20)`, `ip:varchar(45)?`.

### Importador y sistema
**`import_jobs`** — `id`, `created_at`, `updated_at`, `version`, `type:varchar(20)`, `status:varchar(20)`, `dry_run:boolean`, `file_name:varchar(255)`, `file_sha256:character(64)`, `total_rows`, `processed_rows`, `created_count`, `updated_count`, `skipped_count`, `error_count` (todos `integer`), `errors:jsonb`, `started_at:timestamptz?`, `finished_at:timestamptz?`, `created_by:uuid?`.

**`migrations`** — `id:integer`, `timestamp:bigint`, `name:varchar` (control de TypeORM; 7 filas locales).

## 7. Pendientes y cuidados
- Rama con trabajo sin mergear: `feature/content-seed` (catálogo y contenido demo + nuevas secciones del CMS). La integración del frontend con el CMS/API **no está terminada**: el panel `/admin` del frontend usa datos simulados (ver `docs/ADMIN.md` en `Department-frontend`).
- Pendientes: probar Wompi real con su sandbox, configurar un proveedor de correo (SMTP) y decidir el hosting (ver `docs/PLAN-PRODUCCION.md` en `Department-frontend`).
- Copia de seguridad rápida: `pg_dump -h localhost -U <usuario> -d department -F c -f department.dump`.
