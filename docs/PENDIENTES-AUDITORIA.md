# Pendientes de la auditoría de backend (ronda 2)

Hallazgos de la auditoría de backend (ronda 2) que **no** se corrigen en la rama `fix/audit-backend-2`, con su descripción y la propuesta de arreglo.

| N.º | Estado | Resumen |
| --- | --- | --- |
| 8 | Pendiente | Pago aprobado con importe distinto: no se puede reembolsar ni limpiar. |
| 10 | Resuelto | El bloqueo de cuentas permite un DoS dirigido. |
| 15 | Pendiente | Media en disco local sin persistencia garantizada. |
| 21 | Pendiente | `schema:log` con ruido (índice GIN, defaults, FKs). |
| 23 | Resuelto | Sin 2FA obligatorio ni cambio forzoso de la contraseña temporal. |
| 25 | Resuelto | Oráculo de códigos de descuento. |
| 26 | Pendiente | Valores de entrada en `pgMessage` de los logs. |
| 27 | Parcial | `ensureEditableDefaults`: corregido lo barato; queda lo de versiones programadas. |
| 28 | Pendiente | Un total de 0 no se puede comprar. |

## Detalle

### 8. Pago aprobado con importe distinto

Si Wompi (o el mock) aprueba una transacción cuyo importe no coincide con el total del pedido, el evento se registra como no conciliado y el pedido no pasa a
pagado, pero el dinero ya se cobró. Hoy no hay forma de devolverlo desde la API: `POST .../refunds` exige un pedido pagado, y el registro del pago
no conciliado tampoco se puede limpiar ni marcar como resuelto, de modo que queda para siempre en las revisiones de conciliación.
**Propuesta**: crear un registro de «reembolso de pago no conciliado» asociado al `payments` (sin pasar por `refunds`/`refund_lines`, que dependen de
líneas del pedido), con su permiso (`orders:refunds`), estado (`pending`/`done`), referencia del reembolso en la pasarela y auditoría; y permitir marcar el pago
como `resolved`. Solo documentado.

### 10. Bloqueo de cuentas como DoS dirigido

**Resuelto** (`fix/security-accounts`): los fallos se cuentan por (cuenta, IP) en la tabla `login_attempts` (staff y clientes): 5 fallos desde una IP bloquean solo esa pareja 15 min; un umbral global de 30 fallos/15 min por cuenta aplica un retroceso creciente (30 s → 15 min) solo a IPs que nunca entraron con éxito; el titular desde su IP habitual no queda bloqueado. Limpieza horaria en mantenimiento (`login_attempts`, 30 días). Quedan las columnas `failed_login_count`/`locked_until` en desuso. Sigue pendiente (no hecho): aviso por email del bloqueo y CAPTCHA.

Texto original del hallazgo:

Tras 5 contraseñas erróneas (`MAX_FAILED_LOGINS`) la cuenta (cliente o staff) se bloquea 15 minutos (`LOCK_MS`) por email, sin tener en cuenta quién intenta entrar.
Quien conozca un email puede enviar 5 intentos cada 15 minutos y mantener bloqueada a esa persona indefinidamente, incluido el titular real de una cuenta de staff.
**Propuesta**: bloquear por pareja (cuenta, IP/huella de dispositivo) o escalar con retardos y CAPTCHA en vez de bloqueo total; avisar por email del bloqueo; y
permitir el desbloqueo por el enlace de restablecer contraseña.

### 15. Media en disco local sin persistencia garantizada

Los archivos subidos (`uploads/`) se guardan en el disco del contenedor. Sin un volumen montado se pierden al redesplegar, y con más de una réplica cada
instancia solo ve sus propios archivos, así que las URL de `media` pueden dar 404 de forma intermitente. No hay copia de seguridad de esos archivos.
**Propuesta**: abstraer el almacenamiento en un driver (`local` por defecto) y añadir un driver S3/R2 (subida directa o firmada, URL pública por CDN), con
migración de los archivos existentes y variable `MEDIA_DRIVER`.

### 21. Ruido en `schema:log`

`typeorm schema:log` (y `migration:generate`) propone cambios aunque las migraciones estén al día:
- el índice GIN `idx_products_tags_gin` existe en la base (migración manual) pero no está declarado en la entidad `Product`, así que se propone borrarlo;
- columnas con `DEFAULT gen_random_uuid()` en SQL que la entidad no declara (o al revés), y se propone quitarlas o recrearlas;
- algunas FKs se proponen para recrearse (nombres u opciones `ON DELETE`/`ON UPDATE` distintos de los de las migraciones).
Riesgo: alguien aplica a ciegas un `migration:generate` y borra el índice GIN (búsqueda por etiquetas lenta) o recrea FKs en tablas grandes.
**Propuesta**: declarar el índice GIN con `@Index(..., { synchronize: false })`/`using`, alinear defaults y nombres de FK en las entidades y añadir un chequeo en CI
que falle si `schema:log` no está vacío.

### 23. Sin 2FA obligatorio ni cambio forzoso de contraseña temporal

**Resuelto** (`fix/security-accounts`): `staff_users.must_change_password` (true al crear miembros y en `yarn owner:create`, salvo `OWNER_MUST_CHANGE_PASSWORD=false` para CI/smoke) con 403 `PASSWORD_CHANGE_REQUIRED`; `REQUIRE_STAFF_2FA` (por defecto true en producción) con 403 `TWO_FACTOR_SETUP_REQUIRED` para roles con algún permiso sensible (`TWO_FACTOR_REQUIRED_PERMISSIONS`: roles:write, staff:write, settings:write, orders:payments, orders:refunds, import:write, customers:write, discounts:write); banderas `mustChangePassword`/`twoFactorSetupRequired` en login y `/auth/me`. No existe endpoint de restablecimiento de contraseña de un miembro por un tercero: si se añade, debe poner `must_change_password = true`.

Texto original del hallazgo:

El 2FA (TOTP) del staff es opcional, incluso para `owner`/`admin`. Las cuentas creadas por un administrador o con `owner:create` usan una contraseña temporal que
el usuario no está obligado a cambiar: puede seguir usándola indefinidamente y conocerla otra persona (quien la creó, el canal por el que se envió).
**Propuesta**: columna `must_change_password` (se pone al crear/restablecer por un tercero y obliga a cambiarla antes de cualquier otra llamada) y política
`REQUIRE_2FA_ROLES` para obligar a activar TOTP a los roles privilegiados tras el primer acceso.

### 25. Oráculo de códigos de descuento

**Resuelto** (`fix/security-accounts`): vencido/agotado/inactivo/no vigente/inexistente responden igual (`reason: not_found`; el motivo real se registra); `min_subtotal` y `already_used` solo con código válido y activo; límite 10/min por visitante+carrito y 40/min por visitante en `PUT …/discount` (en memoria por instancia). Nota: la cotización/checkout con código comparte los mensajes uniformes, pero solo el PUT tiene el límite extra.

Texto original del hallazgo:

`PUT /storefront/carts/:id/discount` y la cotización (`GET /storefront/carts/:id`) responden con motivos distintos (`not_found`, `expired`, `usage_limit_reached`,
`already_used`, `min_subtotal`…) y con códigos 422 diferentes. Cualquiera puede probar códigos (el límite de peticiones es solo por IP) y distinguir entre
códigos que no existen y códigos reales caducados o agotados, y, con `email`, saber si un correo ya usó un código.
**Propuesta**: devolver el mismo error genérico `DISCOUNT_INVALID` sin `reason` para no encontrado/caducado/agotado, un límite por carrito/IP más estricto para
este endpoint, y no revelar `already_used` hasta el checkout.

### 26. Valores de entrada en `pgMessage` de los logs

Cuando una consulta falla por una violación de restricción, el filtro de excepciones registra el mensaje de Postgres (`pgMessage`/`detail`), que incluye los valores
de la fila, por ejemplo `Key (email)=(alguien@correo.com) already exists`. Así emails, teléfonos o direcciones acaban en los logs aunque se excluya la query string.
**Propuesta**: registrar solo `code`, `constraint`, `table` y `column` del error de Postgres, nunca `message`/`detail`.

### 27. `ensureEditableDefaults` en documentos solo en borrador

La marca para no repetir el paso era la nota de la versión publicada. Un documento que solo existe como borrador (sin versión publicada) nunca la recibía, así que en
cada arranque se volvían a insertar las claves que el administrador había borrado y se subía `version` del documento (provocando conflictos `If-Match` falsos).
**Corregido en esta rama**: la marca es ahora una fila de auditoría persistente (`content:defaults-applied`) por documento, escrita también cuando no había nada que añadir;
se sigue respetando la nota antigua. No se reinsertan claves borradas ni se sube `version` de borradores sin cambios.
**Queda pendiente**: las versiones `scheduled` (programadas) no reciben los campos nuevos; si se publican después, los campos quedan ausentes hasta la siguiente edición
(la tienda usa sus valores por defecto en código, así que no se rompe nada visible).

### 28. Un total de 0 no se puede comprar

Un cupón del 100 % con envío gratis (o un pedido con todo a 0) da un total de 0 y el checkout responde `INVALID_TOTAL`: la pasarela no admite pagos de 0 y el flujo no
tiene camino alternativo. Es un caso legítimo (muestras, regalos) que hoy es imposible.
**Propuesta**: si el total es 0, saltar la pasarela, crear el pedido como pagado (`payment.provider = "none"`) en la misma transacción, consumir el stock y enviar la
confirmación; el front debe tratar `payment: null` como «pedido confirmado».

## Pendientes derivados de las correcciones de esta rama

- **Newsletter (hallazgo 20)**: `GET /storefront/newsletter/confirm` sigue cambiando estado porque el BFF del front
  (`src/app/api/account/newsletter/confirm/route.ts`) lo llama por GET. El front debe migrar a `POST /storefront/newsletter/confirm?token=`;
  después, el GET podrá pasar a validar sin cambiar estado (como ya hace `GET /storefront/newsletter/unsubscribe`).
- **Backorder (hallazgo 14)**: los pedidos pagados *antes* de este cambio con variantes `trackInventory + allowBackorder` nunca descontaron `on_hand`;
  si se cancelan con restock ahora se repondrán esas unidades (stock fantasma de pocas unidades). No hay forma fiable de distinguirlos retroactivamente.
- **Permisos (hallazgo 9)**: los roles personalizados que tenían `orders:write` no reciben `orders:payments` / `orders:refunds`; hay que asignarlos a mano en el panel.
- **Revalidación (hallazgo 7)**: los movimientos de stock ya solo revalidan `catalog:product:<handle>` (y colecciones manuales con ese producto). Las colecciones
  inteligentes, el home y los listados que muestren «agotado» se actualizan por su `revalidate` temporal, no al instante.

## Seguridad de cuentas, ronda 2 (`fix/security-accounts-2`)

**Resuelto**
- **2FA sin recuperación**: `POST /auth/2fa/disable` acepta también un código de recuperación (se consume); `POST /auth/2fa/recovery-codes` (contraseña + TOTP o código de recuperación) regenera los 8 códigos; `yarn staff:reset-2fa <email>` y `yarn staff:unlock <email>` (con acceso a la BD, auditan con actor `system`) cubren «sin móvil y sin códigos» y los bloqueos de login.
- **change-password**: rechaza nueva == actual (422 `PASSWORD_UNCHANGED`) y devuelve una sesión nueva (`accessToken` + cookie `dept_rt`, `mustChangePassword: false`).
- **`2fa/enable` como oráculo**: los fallos cuentan como en `disable` (cuenta+IP); `setup` y `enable` con el throttle de auth; el secreto pendiente de menos de 10 min se reutiliza (migración `totp_setup_at`).
- **2FA obligatorio**: ahora para cualquier rol con `roles:write`, `staff:write`, `settings:write`, `orders:payments`, `orders:refunds`, `import:write`, `customers:write` o `discounts:write` (`TWO_FACTOR_REQUIRED_PERMISSIONS`).
- **IPv6 y retroceso global**: IPv6 se normaliza a /64 y `::ffff:a.b.c.d` a IPv4 igual en `login_attempts` y el throttler. El retroceso global deja pasar a una cuenta con 2FA cuando la misma petición trae contraseña **y** código correctos (razonamiento: ambos factores son lo que el freno quiere demostrar; un código erróneo sigue contando, así que no se puede adivinar TOTP gratis). Las cuentas sin 2FA y los clientes mantienen el retroceso.
- **Clientes**: cambio de contraseña y borrado de cuenta usan `visitorIp` como el login.
- **Descuentos**: se comprueba primero el límite por visitante, luego visitante+carrito; al llenarse el mapa se desalojan las entradas más antiguas (ya no `clear()`); `Retry-After` en el 429.
- **Configuración**: con `NODE_ENV=production` se rechaza `OWNER_MUST_CHANGE_PASSWORD=false` y `REQUIRE_STAFF_2FA=false` emite un warning al arrancar.

**Pendiente / no hecho**
- Carrera de lectura/escritura del umbral global (30 fallos): la comprobación sigue siendo una lectura previa; una ráfaga de peticiones realmente paralelas puede colar unos pocos intentos extra (acotado por el throttler 5/min/IP y por el bloqueo atómico por pareja). Un UPDATE atómico exigiría un contador agregado por cuenta; no se hizo por no ser barato.
- Durante un retroceso global activo, el titular con 2FA debe enviar el código en la misma petición que la contraseña (si no, ve `INVALID_CREDENTIALS`); el front debería ofrecer reenviar ambos. Salida de emergencia: `yarn staff:unlock <email>`.
- Filas antiguas de `login_attempts` con IPv6 sin normalizar quedan como cubos aparte hasta que la limpieza horaria las purgue (30 días).
- Los tokens de acceso ya emitidos siguen válidos hasta expirar tras cambiar la contraseña (JWT sin estado); solo los refresh tokens se revocan.
