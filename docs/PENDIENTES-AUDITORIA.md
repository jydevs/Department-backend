# Pendientes de la auditoría de backend (ronda 2)

Hallazgos que **no** se corrigen en la rama `fix/audit-backend-2`. Las descripciones completas están en el informe del auditor; aquí solo queda el rastro
para no perderlos (el encargo de esta rama no incluía su texto, así que cada línea remite al número del informe).

| N.º | Estado | Nota |
| --- | --- | --- |
| 8 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 10 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 15 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 21 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 23 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 25 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 26 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 27 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |
| 28 | Pendiente | Fuera del alcance de esta rama; ver informe del auditor. |

## Pendientes derivados de las correcciones de esta rama

- **Newsletter (hallazgo 20)**: `GET /storefront/newsletter/confirm` sigue cambiando estado porque el BFF del front
  (`src/app/api/account/newsletter/confirm/route.ts`) lo llama por GET. El front debe migrar a `POST /storefront/newsletter/confirm?token=`;
  después, el GET podrá pasar a validar sin cambiar estado (como ya hace `GET /storefront/newsletter/unsubscribe`).
- **Backorder (hallazgo 14)**: los pedidos pagados *antes* de este cambio con variantes `trackInventory + allowBackorder` nunca descontaron `on_hand`;
  si se cancelan con restock ahora se repondrán esas unidades (stock fantasma de pocas unidades). No hay forma fiable de distinguirlos retroactivamente.
- **Permisos (hallazgo 9)**: los roles personalizados que tenían `orders:write` no reciben `orders:payments` / `orders:refunds`; hay que asignarlos a mano en el panel.
- **Revalidación (hallazgo 7)**: los movimientos de stock ya solo revalidan `catalog:product:<handle>` (y colecciones manuales con ese producto). Las colecciones
  inteligentes, el home y los listados que muestren «agotado» se actualizan por su `revalidate` temporal, no al instante.
