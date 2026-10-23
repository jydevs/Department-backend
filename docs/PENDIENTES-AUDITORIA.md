# Pendientes de la auditoría de backend (ronda 2)

Hallazgos de la auditoría de backend (ronda 2) que **no** se corrigen en la rama `fix/audit-backend-2`, con su descripción y la propuesta de arreglo.

| N.º | Estado | Resumen |
| --- | --- | --- |
| 8 | Pendiente | Pago aprobado con importe distinto: no se puede reembolsar ni limpiar. |
| 10 | Pendiente | El bloqueo de cuentas permite un DoS dirigido. |
| 15 | Pendiente | Media en disco local sin persistencia garantizada. |
| 21 | Pendiente | `schema:log` con ruido (índice GIN, defaults, FKs). |
| 23 | Pendiente | Sin 2FA obligatorio ni cambio forzoso de la contraseña temporal. |
| 25 | Pendiente | Oráculo de códigos de descuento. |
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

El 2FA (TOTP) del staff es opcional, incluso para `owner`/`admin`. Las cuentas creadas por un administrador o con `owner:create` usan una contraseña temporal que
el usuario no está obligado a cambiar: puede seguir usándola indefinidamente y conocerla otra persona (quien la creó, el canal por el que se envió).
**Propuesta**: columna `must_change_password` (se pone al crear/restablecer por un tercero y obliga a cambiarla antes de cualquier otra llamada) y política
`REQUIRE_2FA_ROLES` para obligar a activar TOTP a los roles privilegiados tras el primer acceso.

### 25. Oráculo de códigos de descuento

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
