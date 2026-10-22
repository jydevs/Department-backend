# Fase 1 — Identidad y accesos (contrato)

Alcance: personal administrativo (staff). Clientes de la tienda llegan en la Fase 5.
Reglas globales: TypeScript estricto, Zod DTOs (`createZodDto`), errores con `AppException`, ids uuid v7 (`AppBaseEntity`),
transacciones con `TransactionService`, hora con `Clock`, sin `any`, sin tests (smoke + auditor). Comentarios solo donde el porqué no es obvio.
Prefijo `/api/v1`. Todo endpoint es privado salvo `@Public()`.

## Propiedad de archivos (nadie edita archivos ajenos)
- **Escritor A — `src/identity/entities/**`, `src/identity/permissions.ts`, `src/identity/identity.seed.ts`**
- **Escritor B — `src/identity/auth/**`** (servicio, controlador, tokens, guards, 2FA)
- **Escritor C — `src/identity/staff/**`, `src/audit/**`, `scripts/create-owner.ts`**
- Orquestador — `identity.module.ts`, `app.module.ts`, migración, package.json.

## Entidades (A) — tablas snake_case vía SnakeNamingStrategy
- `StaffUser` (`staff_users`): email (citext-like: guardado en minúsculas, unique), passwordHash text, fullName, isActive bool default true, roleId uuid FK→Role, totpSecretEnc text null (cifrado AES-256-GCM con ENCRYPTION_KEY; en dev sin clave se guarda en claro con prefijo `plain:`), totpEnabled bool default false, recoveryCodesHash text[] default '{}', failedLoginCount int default 0, lockedUntil timestamptz null, lastLoginAt timestamptz null. `extends VersionedEntity`.
- `Role` (`roles`): key varchar(40) unique (`owner|admin|editor|fulfillment|support|analyst`), name, permissions text[] , isSystem bool.
- `RefreshToken` (`refresh_tokens`): staffUserId FK cascade, familyId uuid (index), tokenHash char(64) unique (sha256 del token), expiresAt, revokedAt null, replacedById uuid null, userAgent, ip. Reuso de un token ya rotado ⇒ se revoca toda la familia.
- `AuditLog` (`audit_logs`): actorType varchar(20), actorId uuid null, action varchar(80), entityType varchar(60), entityId varchar(64) null, diff jsonb null, requestId, ip, createdAt (sin updatedAt: append-only). Índices (entityType, entityId) y (actorId, createdAt).
Exportar todo desde `src/identity/entities/index.ts`.

## Permisos (A) — `permissions.ts`
`export const PERMISSIONS = [...] as const` con formato `recurso:accion` (`staff:read`, `staff:write`, `roles:read`, `audit:read`, `settings:write`,
`products:read|write`, `orders:read|write`, `customers:read|write`, `content:read|write|publish`, `media:write`, `discounts:write`, `analytics:read`) y
`ROLE_DEFAULTS: Record<RoleKey, Permission[]>` (owner = todos; admin = todos menos `roles:write`; editor = content/media/products; fulfillment = orders; support = orders/customers lectura+notas; analyst = solo `*:read`+analytics).
`identity.seed.ts`: `seedRoles(dataSource)` idempotente (upsert por key).

## Auth (B) — endpoints bajo `/auth`
- `POST /auth/login` `{email,password,totp?}` `@Public`, throttle 5/min. → `{accessToken, expiresIn, user}`; refresh en cookie `dept_rt` (httpOnly, secure en prod, sameSite=lax, path=/api/v1/auth). Si `totpEnabled` y falta `totp` ⇒ 401 `TWO_FACTOR_REQUIRED`. Fallo genérico `INVALID_CREDENTIALS` (mismo tiempo de respuesta: hashear contra hash dummy si el usuario no existe). 5 fallos ⇒ bloqueo 15 min.
- `POST /auth/refresh` `@Public` (cookie) → rota token; detecta reuso.
- `POST /auth/logout` revoca la familia. `GET /auth/me` → usuario + permisos.
- `POST /auth/2fa/setup` (devuelve otpauth URL), `POST /auth/2fa/enable {code}` (devuelve 8 recovery codes una sola vez), `POST /auth/2fa/disable {password,code}`.
- `POST /auth/change-password {current,new}` (≥12 caracteres) revoca todas las familias.
- Access token JWT (`jose`, HS256, `JWT_ACCESS_SECRET`, 15 min, claims `sub`, `role`; el usuario y su rol se cargan de BD en cada petición: desactivarlo o cambiarle el rol surte efecto de inmediato; cambiar la contraseña revoca los refresh y el access token caduca a lo sumo a los 15 min. No existe el claim `pv`). Refresh 30 días, opaco (32 bytes base64url, no es un JWT: por eso no existe `JWT_REFRESH_SECRET`), guardado solo como hash.
- argon2id (memory 19MiB, t=2, p=1). En dev sin secretos, derivar secreto efímero con warning en el log.
- **Guards globales** (`APP_GUARD` en orden Throttler → `AuthGuard` → `PermissionsGuard`): `AuthGuard` respeta `@Public()`, valida Bearer, carga actor `staff` en `req.actor` y `RequestContextStore.setActor`. `PermissionsGuard` exige TODOS los permisos de `@RequirePermissions`; si un handler no es público y no declara permisos, basta con estar autenticado.
- Exportar `AuthModule` con los guards como providers (los registra el orquestador).

## Staff (C) — `/admin/staff`, `/admin/roles`
- `GET /admin/staff` (`staff:read`, paginación `PageQueryDto`), `POST` (`staff:write`, crea con contraseña temporal aleatoria devuelta una vez), `GET :id`, `PATCH :id` (nombre, rol, isActive), `DELETE :id` = desactivar (no borrar) y revocar tokens. Nadie puede degradar/desactivar al último owner activo ni a sí mismo. Solo owner asigna rol owner.
- `GET /admin/roles` (`roles:read`).
- Params con `IdParamDto`. Respuestas sin `passwordHash`/secretos (mapear a DTO explícito).

## Auditoría (C) — `src/audit`
- `AuditService.record({action, entityType, entityId?, diff?}, manager?)`: toma actor/ip/requestId de `RequestContextStore`; usa el `EntityManager` recibido para quedar en la misma transacción. Exportado por `AuditModule` (global).
- `GET /admin/audit-logs` (`audit:read`, cursor con `CursorQueryDto`, filtros `entityType`, `actorId`). Cursor `{c: ISO ms, id}` ordenado por (createdAt desc, id desc).
- Registrar: login ok/fallido, logout, cambios de 2FA/contraseña, CRUD de staff (B y C llaman a `AuditService`).

## Bootstrap (C)
`scripts/create-owner.ts` (ts-node): lee `OWNER_EMAIL`, `OWNER_PASSWORD` de env, ejecuta `seedRoles`, crea el owner si no existe. Script `yarn owner:create`.

## Criterio de aceptación
`yarn typecheck && yarn lint && yarn build` limpios; `yarn smoke` ampliado por el orquestador: login → me → 2FA no requerido → refresh → logout; ruta admin sin token = 401; con rol sin permiso = 403.
