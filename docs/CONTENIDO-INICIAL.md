# Contenido inicial de la tienda (`yarn content:complete`)

Después de sembrar la base con `yarn content:seed` y `yarn catalog:seed` la tienda funciona, pero quedan tres cosas que
de otro modo habría que hacer a mano: textos en inglés, enlaces de contacto/legales en el pie, páginas legales y zonas de envío.
`yarn content:complete` las resuelve de forma **idempotente** y **segura** (usa los servicios del backend, así que pasan
las mismas validaciones, auditoría y avisos de revalidación que el panel admin).

## Uso

```bash
# 1) Simulacro: muestra qué haría, sin escribir nada
DATABASE_URL=postgres://usuario:clave@host:5432/basedatos yarn content:complete --dry-run

# 2) Ejecución real (las páginas legales quedan en BORRADOR)
DATABASE_URL=... yarn content:complete

# 3) Cuando hayas revisado los textos legales: publicarlos (y enlazarlos en el pie)
DATABASE_URL=... yarn content:complete --publish-legal
```

Si `DATABASE_URL` no se pasa, se lee del `.env` del repo. El script imprime el nombre de la base a la que se conecta.
Las variables `STOREFRONT_URL` y `STOREFRONT_REVALIDATE_SECRET` (las mismas de la API) se usan para avisar a la tienda y que
refresque su caché; sin ellas el script funciona igual, solo que la tienda se actualiza cuando caduque su caché.

| Opción | Efecto |
| --- | --- |
| `--dry-run` | Muestra el plan (`[SIMULADO]`) y los avisos; no escribe nada. |
| `--publish-legal` | Publica las páginas legales (por defecto se crean como borrador). También publica las que ya existen en borrador, sin cambiar su contenido. |
| `--only=translate\|footer\|legal\|shipping` | Ejecuta solo ese paso. Se puede repetir (`--only=legal --only=footer`) o separar por comas. |
| `--help` | Ayuda. |

El código de salida es distinto de 0 si algún paso tuvo errores. Al final imprime un resumen
(`creado / actualizado / ya existía / omitido / avisos / errores`).

## Qué hace

### 1. `translate` — traducción de textos sembrados

Cambia al español los textos que el seed dejó en inglés (hero, "Nuevos ingresos", menús de cabecera y pie, etiquetas de
filtros de colección, valores de la marca, marquees, textos SEO, textos de accesibilidad, página Comunidad, 404, títulos
de colecciones). La lista completa está en `scripts/complete-storefront/translations.ts`: cada regla guarda el valor
**original sembrado** y solo se aplica si el texto actual es **exactamente** ese valor. Lo que el admin ya editó nunca se pisa.

- Cada documento modificado pasa por el flujo normal **borrador → publicar**: versión nueva, auditoría y aviso de
  revalidación, con la nota *"Traducción automática del contenido sembrado"*. Se puede deshacer restaurando la versión anterior
  desde el historial del admin.
- Si un documento tiene **cambios sin publicar** en su borrador, se omite con un aviso (publicar sin más publicaría a medias el
  trabajo del admin). Publica o descarta el borrador y vuelve a ejecutar.
- Colecciones (entidad del catálogo): `Clothes` → `Ropa` (all), `Ropa hombre` (men), `Ropa mujer` (women), y el título SEO
  (`Clothes — Men` → `Ropa — Hombre`...). Los **handles no cambian**. Se actualizan con el servicio de colecciones, solo si título y/o título SEO siguen siendo el valor sembrado.

Decisiones de traducción (se pueden cambiar editando `translations.ts`):

| Texto sembrado | Resultado | Motivo |
| --- | --- | --- |
| `Scroll` (hero) | `Desliza` | Verbo natural para invitar a bajar. |
| `Uniforms for the unnoticed` (lema) | `Uniformes para los invisibles` | Mismo sentido, corto y con tono de marca. Se aplica en tagline, SEO, anuncio, marquees, 404 y pie. |
| `Home / Clothes / Men / Women / Community` | `Inicio / Ropa / Hombre / Mujer / Comunidad` | Menús de cabecera, pie, búsqueda, migas, pestañas de colección y tarjetas del inicio. |
| `New` / `Arrivals` | `Nuevos` / `Ingresos` | Coherente con el eyebrow "01 — Nuevos ingresos". |
| `We were not born to follow rules…` | `No nacimos para seguir reglas, sino para reescribirlas.` | |
| `Intentional Design / Made With Care / A Team With A Goal` y sus frases | `Diseño intencional / Hecho con cuidado / Un equipo con un objetivo`... | También en el marquee de Comunidad. |
| `Price` / `Availability` | `Precio` / `Disponibilidad` | Filtros de la plantilla collection. |
| Página `Community` (título, SEO) | `Comunidad` | El handle `community` no cambia. |

**Se conservan a propósito** (nombres propios, de marca o términos de uso corriente): `Daregular Dept.`, `Rags to Riches` y
`Extended Version` (nombre de la campaña; incluye el eyebrow del hero), `Regular Members Only` y `Daregular Members` (nombre/lema del club),
`Lookbook`, `Newsletter`, y los nombres de producto del catálogo. Si prefieres traducir alguno, edítalo en el admin o añade una regla.

### 2. `footer` — enlaces en el pie de página

La tienda pinta el pie con la sección `footer` de la plantilla `layout`: columnas (bloques `column`) con enlaces propios y/o un menú.
El script añade, **sin tocar las columnas existentes**:

- Columna **Ayuda** con `Contacto` → `/pages/contact`, solo si el pie no enlaza ya a esa página (ni en el menú `footer` ni en ninguna columna) y la página `contact` está publicada.
- Columna **Legal** con las cuatro páginas legales, solo cuando **todas están publicadas** (para no enlazar a una 404 ni dejar una columna a medias). Por eso, con las legales en borrador, esta columna aparece en la ejecución posterior: tras publicarlas (con `--publish-legal` o desde el admin) ejecuta `yarn content:complete --only=footer`.

No modifica el menú principal de la cabecera (los enlaces de ayuda/legales van solo en el pie). El pie admite hasta 6 columnas; si no caben, avisa y no cambia nada.
Las columnas nuevas se añaden tras las existentes: en pantallas anchas la tienda las coloca en una segunda fila de la cuadrícula del pie.

### 3. `legal` — páginas legales

Crea cuatro páginas del CMS (tipo `page`, secciones `page-header` + `rich-text`, con título y descripción SEO):

| Handle | Contenido |
| --- | --- |
| `terminos-y-condiciones` | Quiénes somos, productos y precios, pedidos y pagos, envíos y riesgo, retracto y garantía, propiedad intelectual, ley aplicable. |
| `politica-de-privacidad` | Responsable, datos recolectados, finalidades, autorización y encargados, derechos del titular (habeas data), canal y plazos de consultas/reclamos, cookies, seguridad, menores, vigencia. Ley 1581 de 2012 y Decreto 1377 de 2013. |
| `envios-y-devoluciones` | Cobertura, plazos y tarifas (tomados de los parámetros de envío del script), recepción, derecho de retracto (art. 47 Ley 1480 de 2011: 5 días hábiles), cómo devolver, reembolsos (30 días calendario). |
| `cambios-y-garantias` | Cambios por talla (política comercial), garantía legal (Ley 1480), cómo solicitarla. |

- Por defecto quedan en **BORRADOR** (no visibles en la tienda). Con `--publish-legal` se publican.
- **Nunca pisa**: si la página ya existe (aunque la hayas editado) no se cambia su contenido. Solo con `--publish-legal` se publica una que nunca estuvo publicada.
- Todo dato del negocio que falte aparece como marcador **`[COMPLETAR: ...]`** en el propio texto (razón social, NIT, dirección, correo, teléfono, transportadora, plazos, IVA, pasarela de pagos, proveedores...). El script cuenta los marcadores de cada página.
  Para rellenar los datos básicos antes de crear las páginas, edita el objeto `BUSINESS` al inicio de `scripts/complete-storefront.ts`; el resto se completa en `/admin/content/pages/<handle>`.
- Se escriben con el Markdown que entiende la tienda (párrafos, listas `- `, subtítulos `### `, negrita) para que se vean bien.

### 4. `shipping` — zonas y tarifas de envío

Crea **solo lo que falte** (por nombre de zona). Parámetros editables al inicio de `scripts/complete-storefront.ts` (`SHIPPING_ZONES`, `FREE_SHIPPING_OVER`):

| Zona | Departamentos | Tarifas |
| --- | --- | --- |
| Bogotá y Cundinamarca | `Bogotá D.C.`, `Cundinamarca` | Estándar $9.000 (1–3 días); Express $15.000 (1 día) |
| Principales ciudades | Antioquia, Atlántico, Valle del Cauca, Santander, Bolívar, Risaralda, Caldas, Quindío | Estándar $12.000 (2–5 días) |
| Resto del país | Todos los demás departamentos | Estándar $16.000 (3–7 días) |

Envío gratis desde **$300.000** (subtotal con descuentos) en las tarifas Estándar. Los nombres de departamento son exactamente los que
envía el checkout de la tienda (`src/lib/geo.ts` del front); si allí cambian, actualiza la lista `DEPARTMENTS` del script.

- Si una zona ya existe (por nombre) **no se modifica** ni se tocan sus tarifas, aunque difieran de estos valores. Solo si existe **sin ninguna tarifa** se crean las tarifas que faltan.
- El backend no valida solapes entre zonas. Si ya hay zonas activas que cubren los mismos departamentos (p. ej. una zona `*` "Colombia"), el script **avisa** (`[AVISO]`) y crea igualmente; el checkout mostrará las tarifas de todas las zonas que cubran el departamento. Ajusta o desactiva lo que sobre en `/admin/shipping`.

## Qué NO hace

- No pisa textos, páginas, menús, zonas ni tarifas existentes que el admin ya haya editado; no borra nada.
- No traduce nombres de producto, descripciones del catálogo, imágenes ni textos de colecciones que ya cambió el admin.
- No toca la cabecera/menú principal con enlaces nuevos, ni el menú `footer` (sus ítems solo se traducen).
- No rellena los datos legales del negocio (quedan como `[COMPLETAR: ...]`).
- No publica las páginas legales salvo con `--publish-legal`.
- Con `--dry-run` no escribe nada (ni contenido, ni colecciones, ni envíos, ni avisos de revalidación).
- Las entradas de auditoría de estos cambios quedan sin usuario (acción del sistema, `anonymous`); el historial de versiones del documento lleva la nota del cambio.

## Cómo revisar y completar las páginas legales

1. `yarn content:complete` crea los borradores. Ábrelos en el admin (`/admin/content/pages/<handle>`) o usa la vista previa.
2. Busca los marcadores `[COMPLETAR: ...]` y sustitúyelos por los datos reales (razón social, NIT, dirección, correo, teléfonos, transportadora, plazos reales de alistamiento/cambios, IVA, pasarela de pagos, proveedores y cookies reales).
3. **Que un abogado revise los cuatro textos** (con tu operación real: medios de pago, transportadoras, analítica, cambios y excepciones al retracto) antes de usarlos en producción.
4. Publica desde el admin, o ejecuta `yarn content:complete --publish-legal` (publica las páginas que sigan en borrador) y después `--only=footer` si hace falta (con `--publish-legal` el pie se actualiza en la misma ejecución).
5. Las tarifas que aparecen en `envios-y-devoluciones` son una copia de los parámetros del script; si cambias las tarifas en `/admin/shipping`, actualiza también el texto.

> **ADVERTENCIA LEGAL.** Los textos legales generados son **borradores de partida, no asesoría legal definitiva**. Se basan en
> las normas colombianas aplicables a una tienda en línea (Ley 1480 de 2011 — Estatuto del Consumidor, art. 47 retracto y garantía legal;
> Ley 1581 de 2012 y Decreto 1377 de 2013 — protección de datos personales), pero deben ser revisados y ajustados por un abogado
> antes de publicarse en producción. No los presentes como definitivos.

## Idempotencia y seguridad

- Se puede ejecutar cuantas veces haga falta: la segunda ejecución no cambia nada (todo aparece como `YA EXISTÍA`).
- Cada cambio de contenido es una versión nueva en el historial (restaurable) y la revalidación avisa a la tienda.
- Orden interno: traducción → legales → pie → envíos (las legales antes que el pie, que solo enlaza lo publicado).
- Requisitos: migraciones aplicadas y seed (`yarn content:seed`, `yarn catalog:seed`). Si falta un documento del seed, el paso lo omite con un aviso.
