# Fase 5 — Clientes, marketing y correos (contrato)

Reglas globales: las de las fases 1–4 (TS estricto sin `any`, Zod DTOs, `AppException`, `TransactionService`, `AuditService`, `Clock`, permisos por endpoint,
SQL parametrizado, sin tests, DTO de respuesta explícitos). Datos personales = Habeas Data (Ley 1581 de 2012): mínimo necesario, consentimiento explícito, exportación y borrado/anonimización.

## Clientes (cuentas del storefront) — `src/customers/**`
Entidades (`src/customers/entities/**`), snake_case, uuid v7:
- `Customer` (VersionedEntity): email varchar(255) UNIQUE (guardado en minúsculas), passwordHash text null (null = cliente invitado sin cuenta), firstName, lastName, phone null, acceptsMarketing bool default false,
  marketingConsentAt timestamptz(3) null, isActive bool default true, emailVerifiedAt null, failedLoginCount int default 0, lockedUntil null, lastLoginAt null, tags text[] default '{}', internalNote text null,
  anonymizedAt timestamptz(3) null, deletedAt (soft). 
- `CustomerAddress`: customerId FK cascade, label varchar(40) null, isDefault bool, campos de dirección del `addressSchema` (fullName, phone, department, city, address1, address2, postalCode, documentType, documentNumber). Máx 10 por cliente.
- `CustomerRefreshToken` (mismo diseño que `RefreshToken` del staff: familyId, tokenHash sha256 unique, expiresAt, revokedAt, replacedById, userAgent, ip).
- `CustomerToken` (`customer_tokens`): customerId FK cascade, type varchar(20) (`password_reset|email_verify`), tokenHash char(64) unique, expiresAt, usedAt null. Reset: 1 h; verificación: 48 h; un solo uso.
- `Order.customerId` ya existe (Fase 4): al registrarse o iniciar sesión se enlazan pedidos previos del mismo email VERIFICADO (nunca de email no verificado).

Auth de clientes (`/storefront/customers/...`, separados del staff): `POST register {email, password(12..256), firstName, lastName, acceptsMarketing}` (no revela si el email ya existe: responde 202 igual y, si existía, no crea nada), `POST login` (argon2id con los mismos parámetros que el staff; bloqueo atómico 5 fallos/15 min por cuenta, error genérico, tiempo constante con hash dummy, throttle 5/min), `POST refresh` (cookie `dept_ct` httpOnly path `/api/v1/storefront/customers`, rotación + detección de reuso con `FOR UPDATE`, igual que el staff), `POST logout`,
`POST forgot-password {email}` (siempre 202; token de un solo uso enviado por correo; throttle 3/min), `POST reset-password {token, password}` (revoca todas las sesiones), `POST verify-email {token}`. Access token JWT HS256 distinto del staff (claim `typ:"customer"`, `aud:"storefront"`; el `AuthGuard` del staff NO debe aceptarlo y viceversa): añade un `CustomerAuthGuard` propio y el decorador `@CustomerAuth()`; el actor `customer` ya existe en `src/common/auth/actor.ts`.
Cuenta (`@CustomerAuth()`): `GET/PATCH /storefront/customers/me`, `POST me/change-password`, CRUD `me/addresses` (una sola default), `GET me/orders` y `GET me/orders/:orderNumber` (solo propios), `POST me/data-export` (JSON con todos sus datos, `Cache-Control: no-store`), `DELETE me` (Habeas Data: anonimiza — email `deleted+<id>@invalid`, nombre/teléfono/direcciones borrados, sesiones revocadas, pedidos conservan datos fiscales mínimos anonimizados — con confirmación de contraseña).
Admin (`/admin/customers`, permisos `customers:read|write`): listado paginado con `q` (email/nombre, escapado), filtros `acceptsMarketing`, `tag`; detalle con pedidos y direcciones; PATCH (nombre, teléfono, tags, nota, isActive) con auditoría; `POST :id/erase` (anonimización, `customers:write`, solo owner/admin); `GET /admin/customers/export` CSV (escape de fórmulas: prefijar con `'` celdas que empiezan por `= + - @`), máx 50 000 filas en streaming.
Guest checkout: al crear un pedido con un email que ya tiene cuenta, `customerId` queda null hasta que el cliente verifique/inicie sesión.

## Correos transaccionales — `src/mail/**`
- `MailService.send({ to, template, data, locale })` sobre una interfaz `MailTransport` con `SmtpTransport` (nodemailer; env `SMTP_URL`, `MAIL_FROM`) y `LogTransport` (dev/test: registra en log y guarda en `EmailOutbox`). `MAIL_TRANSPORT=log|smtp` (por defecto `log`; en producción exige `smtp`).
- `EmailOutbox` (`email_outbox`): to, template, subject, bodyHtml, bodyText, status (`pending|sent|failed`), attempts, lastError, sendAfter, sentAt. Envío ASÍNCRONO: quien encola escribe en la outbox dentro de su transacción; un `MailWorker` (cada 15 s, `FOR UPDATE SKIP LOCKED`, lotes de 20, reintentos con backoff exponencial hasta 5) los envía. Nunca bloquear la petición del usuario.
- `EmailTemplate` (`email_templates`): key varchar(60) unique (`order_confirmation`, `order_shipped`, `order_cancelled`, `password_reset`, `email_verify`, `welcome`, `refund_issued`), subject, bodyHtml, bodyText, isActive. Plantillas por defecto sembradas en español (idempotente, `seedEmailTemplates`). Render con un motor propio mínimo `{{ path.to.value }}` con ESCAPE HTML por defecto (sin lógica, sin ejecución de código, sin acceso a prototipos); `{{{ raw }}}` NO existe.
- Admin `/admin/email-templates` CRUD parcial (listar, GET, PUT — no crear claves nuevas), `POST :key/preview {data}` y `POST :key/test-send {to}` (`marketing:write`).
- Engancha eventos: pedido pagado (`order_confirmation`), fulfillment con `notifyCustomer` (`order_shipped`), cancelación (`order_cancelled`), reembolso (`refund_issued`), registro (`email_verify`, `welcome`), reset (`password_reset`). El enlace de las plantillas usa `STOREFRONT_URL`. Los servicios de la Fase 4 llaman a `MailService.enqueue(..., manager)` (método transaccional) — el orquestador hace ese cableado.

## Marketing — `src/marketing/**`
- `NewsletterSubscriber`: email UNIQUE minúsculas, status (`pending|subscribed|unsubscribed`), source varchar(40), consentAt, confirmTokenHash, unsubscribeTokenHash (doble opt-in; enlace de baja de un clic firmado), ip (truncada /24 o /48 para privacidad). `POST /storefront/newsletter {email, source}` (202 siempre, throttle 5/min, no revela existencia; envía correo de confirmación), `GET /storefront/newsletter/confirm?token=`, `GET|POST /storefront/newsletter/unsubscribe?token=`.
- `ContactMessage`: name, email, subject null, message (≤ 4000), status (`new|read|replied|spam`), ip truncada, createdAt. `POST /storefront/contact` (throttle 3/min, honeypot `website` que si viene lleno responde 202 y descarta, límites de longitud, sin HTML). Admin: `GET /admin/contact-messages` (paginado, filtros), `PATCH :id {status}`, `DELETE :id`; `GET /admin/newsletter` (paginado, filtros por status, `q`), `GET /admin/newsletter/export` (CSV con escape de fórmulas, solo `subscribed`), `POST :id/unsubscribe`. Permisos `marketing:read|write` (el orquestador los añade).

## Analítica admin — `src/analytics/**` (`analytics:read`)
`GET /admin/analytics/overview?from=&to=` (ventas netas, pedidos, ticket medio, clientes nuevos, tasa de pedidos pagados/expirados, comparación con periodo anterior), `/sales?groupBy=day|week|month`, `/top-products?limit=`, `/customers`. Consultas agregadas parametrizadas sobre `orders`/`order_lines`/`customers` (solo pedidos `open|completed`, en COP), rango máximo 366 días, zona horaria `America/Bogota` para agrupar por día, sin N+1, con índices adecuados.

## Propiedad de archivos
- **K1 (entidades)** — `src/customers/entities/**`, `src/mail/entities/**`, `src/marketing/entities/**`.
- **K2 (clientes)** — `src/customers/**` (excepto entities).
- **K3 (correo + marketing)** — `src/mail/**` (excepto entities), `src/marketing/**` (excepto entities).
- **K4 (analítica)** — `src/analytics/**`.
- Orquestador — módulos raíz, `app.module.ts`, permisos, env, migración, cableado de correos en la Fase 4, smoke.

## Criterio de aceptación (smoke)
Registrar cliente → correo de verificación en outbox → verificar → login → refresh con rotación (reuso rechazado) → crear dirección → comprar como cliente y ver `me/orders` → forgot/reset password → export de datos → borrado anonimiza; suscripción con doble opt-in y baja; contacto con honeypot; plantilla preview escapa `<script>`; analytics overview coincide con los pedidos del smoke; el token de cliente NO abre `/admin/*` ni el de staff abre `/storefront/customers/me`.
