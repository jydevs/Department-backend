# Panel de administración y tienda: estado de la integración con esta API

El panel de administración vive en `Department-frontend` (rutas `/admin`; ver `docs/ESTADO.md` y `docs/ADMIN.md` allí).
Hoy es **solo visual** (datos simulados, sin login) y la tienda pública usa datos locales: **ninguno de los dos consume esta API todavía**.
Esta rama no cambia endpoints; solo incorpora la rama `feature/content-seed` (semilla del CMS y catálogo demo).

## Qué necesita el front de esta API (resumen)

- **Tienda:** catálogo, carrito, checkout, pagos y cuenta de cliente (`/api/v1/storefront/*`), más el contenido dirigido por el CMS
  (`/storefront/content/*`) con revalidación (`POST {STOREFRONT_URL}/api/revalidate`) y vista previa (`/api/preview`). Ver `docs/API.md` §7 y `docs/CMS-SECTIONS.md`.
- **Panel:** `/api/v1/auth/*` (login + cookie `dept_rt`, `me` con permisos, 2FA) y `/api/v1/admin/*` por módulo. Permisos por rol en `docs/API.md` §2.
- **Esquemas de secciones:** `GET /admin/content/section-types` entrega JSON Schema por sección; el editor del panel debe generar sus formularios de ahí.

## Rutas que el backend espera y el front aún no implementa

`/api/revalidate`, `/api/preview`, `/checkout/result`, `/mock-checkout/[reference]` (solo con `PAYMENT_PROVIDER=mock`), `/orders/[n]`,
`/account/forgot-password`, `/newsletter/confirmar`, `/newsletter/baja`.

## Datos de arranque en desarrollo

`yarn migration:run` → `yarn owner:create` → `yarn catalog:seed` → `yarn content:seed` (ver `README.md` y `docs/BASE-DE-DATOS-LOCAL.md`).
La semilla **no** crea zonas ni tarifas de envío: sin ellas el checkout no puede cotizar envío (créalas desde `/admin/shipping/*`).

## Hoja de ruta y plan de producción

Hoja de ruta de la integración (F1–F7): `Department-frontend/docs/ESTADO.md` §7. Plan de producción: `Department-frontend/docs/PLAN-PRODUCCION.md`.
