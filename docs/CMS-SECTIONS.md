# CMS: documentos y tipos de sección

Guía para el desarrollador del front: qué documento alimenta cada parte del sitio y qué `settings`/`blocks` tiene cada tipo de sección.
La fuente de verdad es `src/cms/sections/registry.ts`; el admin obtiene los JSON Schema con `GET /admin/content/section-types`.
El contenido por defecto (el texto, imágenes y enlaces que antes estaban "quemados" en el front) está en `src/cms/seed/default-content.ts`
y se siembra, ya publicado, con `yarn content:seed` o al arrancar la API (`SEED_DEFAULT_CONTENT=true`).

## Convenciones

- **Defaults no almacenados.** Los `default` de las tablas se aplican al validar, pero el JSON guardado solo trae lo que el admin envió. El front debe aplicar el mismo default cuando falte la clave.
- **Titulares multilínea:** un `\n` en `heading` separa líneas (cada una se anima como `mask-line`). `headingAccent` se añade tras la última línea con el color de acento (el punto rojo de "the unnoticed.").
  `headingOutline` es la línea final dibujada con trazo (`text-outline`).
- **Sin HTML.** Solo texto plano; `markdown` (editorial, rich-text) permite Markdown con enlaces `https://`, `/ruta`, `mailto:`, `tel:`.
- **URLs:** imágenes `https://…` o `/ruta` (el front sirve `/images/...` desde `public/`); enlaces además `mailto:`/`tel:`. Los anclajes internos usan `anchorId`/`scrollTargetId` (sin `#`).
- **Contadores** ("NN piezas"): los calcula el front con la API de colecciones; el CMS solo guarda la etiqueta (`countLabel`) y si se muestran (`showCount`). Formato `String(n).padStart(2, "0")`.
- **Colores:** `#RRGGBB`. Si falta un color, usar el token del tema (`settings/site` → `theme.colors`).
- Ids de sección/bloque: `^[a-z0-9-]{3,40}$`, únicos en el documento. Máx. 40 secciones por documento y 50 bloques por sección.

## Documentos y a qué componente del front alimentan

| Documento (`kind/key`) | Contenido | Componente / archivo del front |
| --- | --- | --- |
| `settings/site` | Marca (`brand.name`, `tagline`, `description`), tema (`theme.colors`, `theme.fonts`, `colorScheme`), SEO (`seo.titleTemplate`, `defaultTitle`, `defaultDescription`), redes (`social`, vacío: sin URLs oficiales), ticker de anuncio (`announcement`), tienda (`store`) | `src/lib/site.ts`, `app/layout.tsx` (metadata, fuentes, tokens de `globals.css`), ticker de `Header.tsx` |
| `menu/main` | Home · Clothes (hijos: Men, Women) · Community | `Header.tsx` (`NAV` = nivel 1; `MENU_LINKS` del menú móvil = aplanado: padre seguido de sus hijos) |
| `menu/footer` | Home · Clothes · Men · Women | columna "Tienda" de `SiteFooter.tsx` (la sección `footer` la referencia con `menuKey: "footer"`) |
| `template/layout` | `site-header`, `newsletter`, `footer` (secciones globales) | `Header.tsx`, `NewsletterFooter.tsx`, `SiteFooter.tsx` (+ `FooterAccountLinks`, `BackToTopButton`) |
| `template/home` | hero, marquee, new-arrivals, split-banner, campaign, editorial, value-props (en ese orden) | `app/page.tsx` → `components/home/*` |
| `template/collection` | `collection-hero` + `product-grid` | `app/collections/[handle]/page.tsx`, `CollectionView`, `FilterBar`, `ProductGrid` |
| `template/product` | `product-detail` + `product-grid` (source `related`) | `app/products/[handle]/page.tsx`, `ProductInfo`, `StickyAddToCart`, `ProductGrid` |
| `template/search` | `search-panel` | `components/search/*` (`SearchPanel`, `SearchSuggestions`) |
| `template/cart` | `cart-drawer` | `components/layout/CartDrawer.tsx` |
| `template/404` | `error-hero`, `marquee`, `cta-banner` | `app/not-found.tsx` |
| `page/community` | `page-header`, `lookbook`, `marquee`, `cta-banner` | `app/pages/[handle]` (antes `pages/contact/page.tsx` + `LookbookGallery`) |
| `page/contact` | `contact-form` | `components/layout/ContactForm.tsx` |

Notas: la página que el front tenía en `/pages/contact` (cabecera "Daregular Members" + formulario + lookbook + marquee + CTA) se ha separado en `page/community`
(todo salvo el formulario) y `page/contact` (formulario). Para reproducir la página antigua en una sola, añade en el admin una sección `contact-form` a `page/community`.
La clave `layout` se añadió a las claves de template permitidas; se obtiene con `GET /storefront/content/templates/layout` o `GET /storefront/content/bundle?template=layout`.

## Tipos de sección

Notación: `campo: tipo = default`. `?` = opcional. `color` = `#RRGGBB`; `link` = URL de enlace segura; `image` = URL de imagen segura.

### `announcement-bar` — barra de anuncio (para páginas; el ticker global está en `settings/site.announcement`)
| Setting | Tipo |
| --- | --- |
| `text` | string ≤300 |
| `items?` | string[] ≤10 (≤120 c/u): si existe, se muestra como marquesina |
| `href?` | link |
| `backgroundColor?`, `textColor?` | color |
| `dismissible` | boolean = false |

### `site-header` — `Header.tsx` (template `layout`)
| Setting | Tipo |
| --- | --- |
| `menuKey` | handle = "main" (documento `menu` que alimenta la navegación) |
| `logoVariant` | "red" \| "black" = "red" |
| `showAnnouncement`, `showSearch`, `showAccount`, `showCart` | boolean = true |
| `showProductCount` | boolean = true: superíndice con el nº de productos junto al enlace a la colección `all` |
| `transparentOnHero` | boolean = true |
| `homeAriaLabel` = "Daregular Dept. — inicio", `searchLabel` = "Buscar", `accountLabel` = "Cuenta", `cartLabel` = "Carrito", `menuOpenLabel` = "Abrir menú", `menuCloseLabel` = "Cerrar menú", `navLabel` = "Principal", `mobileMenuLabel` = "Menú", `skipLinkLabel` = "Saltar al contenido" | string ≤80 |
| `mobileMenuTagline?` | string ≤120 (por defecto `brand.tagline`) |

### `hero` — `components/home/Hero.tsx`
| Setting | Tipo |
| --- | --- |
| `eyebrow?` | string ≤100 |
| `heading` | string ≤300 (líneas con `\n`) |
| `headingAccent?` | string ≤10 |
| `subheading?` | string ≤300 |
| `imageUrl`, `mobileImageUrl?` | image |
| `imageAlt?` | string ≤300 |
| `ctaLabel?`, `secondaryCtaLabel?` | string ≤60 |
| `ctaHref?`, `secondaryCtaHref?` | link |
| `overlayOpacity` | 0–1 = 0.2 (fuerza del degradado de legibilidad) |
| `overlayColor` | color = "#000000" |
| `alignment` | "left" \| "center" \| "right" = "left" |
| `height` | "medium" \| "large" \| "full" = "large" (`full` = 100svh) |
| `kenBurns` | boolean = true |
| `scrollLabel?` | string ≤40 |
| `scrollTargetId?` | anchorId: id al que salta el indicador "Scroll" |

```json
{ "id": "home-hero", "type": "hero", "enabled": true, "settings": {
  "eyebrow": "Rags to Riches — Extended Version", "heading": "Uniforms for\nthe unnoticed", "headingAccent": ".",
  "imageUrl": "/images/home-hero.jpg", "imageAlt": "Lookbook Rags to Riches…", "ctaLabel": "Ver colección", "ctaHref": "/collections/all",
  "secondaryCtaLabel": "Lookbook", "secondaryCtaHref": "/pages/community", "overlayOpacity": 0.85, "height": "full",
  "scrollLabel": "Scroll", "scrollTargetId": "new-arrivals" } }
```

### `marquee` — `components/ui/Marquee.tsx` (`MarqueeBand`, marquesinas de community y 404)
| Setting | Tipo |
| --- | --- |
| `speed` | "slow" \| "normal" \| "fast" = "normal" |
| `duration?` | número 5–180: segundos por vuelta (anula `speed`) |
| `variant` | "band" (franja con `backgroundColor`) \| "outline" (texto con trazo) \| "plain" = "band" |
| `size` | "sm" \| "md" \| "lg" = "md" |
| `separator?` | string ≤5 (por defecto el del componente) |
| `separatorColor?`, `backgroundColor?`, `textColor?` | color |
| `bordered` | boolean = false (bordes arriba/abajo) |
| `ariaLabel?` | string ≤120 |

Bloques (máx. 20): `item` → `{ text: string 1–120 }`.

```json
{ "id": "home-marquee", "type": "marquee", "enabled": true,
  "settings": { "speed": "slow", "duration": 46, "variant": "band", "size": "lg", "backgroundColor": "#ffffff", "textColor": "#000000", "separatorColor": "#e10e0e" },
  "blocks": [ { "id": "marquee-item-1", "type": "item", "settings": { "text": "Uniforms for the unnoticed" } } ] }
```

### `new-arrivals` — `components/home/NewArrivals.tsx` (banner a sangre con foto y parallax; cambió: ya no es una cuadrícula)
| Setting | Tipo |
| --- | --- |
| `eyebrow?` | string ≤100 ("01 — Nuevos ingresos"; el front añade " · NN piezas" si `showCount`) |
| `heading` | string ≤300 ("New") |
| `headingOutline?` | string ≤100 ("Arrivals", con trazo) |
| `subheading?` | string ≤300 |
| `imageUrl?`, `imageAlt?` | image / string |
| `overlayColor` = "#000000", `overlayOpacity` = 0.9 | color / 0–1 |
| `parallax` | boolean = true |
| `collectionHandle?` | handle (de ahí sale el contador) |
| `showCount` = true, `countLabel` = "piezas" | boolean / string ≤30 |
| `ctaLabel?`, `ctaHref?` | string ≤60 / link |
| `anchorId?` | id DOM ("new-arrivals") |

### `split-banner` — `components/home/SplitBanner.tsx` (cambió: mosaicos como bloques)
| Setting | Tipo |
| --- | --- |
| `ariaLabel?` | string ≤120 |
| `showCount` = true, `countLabel` = "piezas", `numbered` = true | "0N — NN piezas" |
| `backgroundColor?` | color |
| `heading?`, `text?`, `imageUrl?`, `imageAlt?`, `imagePosition`, `ctaLabel?`, `ctaHref?` | modo antiguo de banner único (solo si no hay bloques `tile`) |

Bloques (máx. 4): `tile` → `{ label (1–60), imageUrl, imageAlt?, collectionHandle? | href? (uno obligatorio), ariaLabel? }`.

```json
{ "id": "tile-women", "type": "tile", "settings": { "label": "Women", "imageUrl": "/images/banner-women.jpg", "imageAlt": "Colección Women — …", "collectionHandle": "women", "ariaLabel": "Ver colección Women" } }
```

### `value-props` — `components/home/ValueProps.tsx`
Settings: `heading?`, `columns` "2"|"3"|"4" = "3", `ariaLabel?`, `showNumbers` = true.
Bloques (máx. 8): `item` → `{ icon: "truck"|"shield"|"refresh"|"credit-card"|"heart"|"star"|"gift"|"chat"|"leaf"|"clock"|"eye"|"user"|"tag", title (1–80), text ≤300 }`.
Los iconos `eye`, `heart`, `user` son los tres del front actual.

### `campaign` — `components/home/CampaignSection.tsx` (título + cuadrícula de productos de una colección)
| Setting | Tipo |
| --- | --- |
| `eyebrow?`, `heading`, `headingOutline?`, `text?` | strings |
| `collectionHandle?` | handle (productos a mostrar) |
| `limit` | 1–24 = 6 |
| `columns` | "3" \| "4" = "3" |
| `showCount` = true, `countLabel` = "piezas" | |
| `ctaLabel?`, `ctaHref?`, `ctaVariant` | "solid"\|"outline"\|"red" = "outline" |
| `imageUrl?`, `imageAlt?`, `alignment` | opcionales (fondo/alineación) |

### `editorial` — `components/home/EditorialBlock.tsx`
Settings: `eyebrow?`, `heading` (líneas con `\n`), `lede?` (párrafo grande), `body` (Markdown ≤5000; línea en blanco = párrafo), `imageUrl?`, `imageAlt?`, `imageBadge?` (etiqueta roja sobre la foto),
`layout` "text-only"|"image-left"|"image-right" = "image-right", `ctaLabel?`, `ctaHref?`, `ctaVariant` = "red".

### `lookbook` — `components/community/LookbookGallery.tsx`
Settings: `heading?`, `layout` "grid"|"carousel"|"masonry" = "grid" (el front usa `masonry` con columnas CSS), `columns` "2"|"3"|"4" = "3" (escritorio; móvil siempre 2), `showCaptions` = true, `ariaLabel?`.
Bloques (máx. 24): `photo` → `{ imageUrl, alt, caption? ("N°01"), productHandle?, aspect: "1/1"|"2/3"|"3/4"|"4/5" = "2/3" }`.

```json
{ "id": "photo-01", "type": "photo", "settings": { "imageUrl": "/images/community-01.jpg", "alt": "Lookbook Daregular Dept. — foto 1", "caption": "N°01", "aspect": "2/3" } }
```

### `newsletter` — `components/layout/NewsletterFooter.tsx`
Settings: `eyebrow?`, `heading`, `text?`, `placeholder` = "Tu correo", `inputLabel?` (label oculto), `buttonLabel` = "Suscribirme" (aria-label del botón con flecha), `loadingMessage?`, `successMessage?`, `errorMessage?`, `backgroundColor?`.
Envía a `POST /storefront/newsletter`.

### `footer` — `components/layout/SiteFooter.tsx`
Settings: `showNewsletter` = false (legado: usar la sección `newsletter`), `showSocial` = true (redes de `settings/site.social`), `brandTitle?`, `brandText?`, `wordmark?` (por defecto `brand.name`), `showWordmark` = true,
`copyright?`, `bottomText?` ("Colombia · COP"), `backToTopLabel?`, `backgroundColor?`.
Bloques (máx. 6):
- `column` → `{ title (1–60), links: [{ label, url }] ≤12, menuKey? }` — con `menuKey` se pintan los ítems de ese menú en lugar de `links`.
- `account-links` → `{ title, accountLabel = "Mi cuenta", cartLabel = "Carrito" }` — acciones que abren el panel de cuenta y el carrito (`FooterAccountLinks`).

### `page-header` — cabecera de `pages/*` ("Comunidad / Daregular Members")
Settings: `eyebrow?`, `heading` (líneas con `\n`), `headingAccent?`, `lead?` (línea display "Regular Members Only."), `text?`, `alignment` = "left".

### `cta-banner` — CTA final de community y bloque inferior de 404
Settings: `eyebrow?`, `heading?`, `text?`, `layout` "stacked"|"split" = "stacked" (split: texto a la izquierda, botones a la derecha), `ctaLabel?`, `ctaHref?`, `ctaVariant` = "red",
`secondaryCtaLabel?`, `secondaryCtaHref?`, `secondaryCtaVariant` = "outline", `backgroundColor?`.

### `contact-form` — `components/layout/ContactForm.tsx`
Settings: `heading`, `showPhone` = true, `nameLabel` = "Nombre", `emailLabel` = "Email", `phoneLabel` = "Teléfono", `subjectLabel` = "Asunto", `messageLabel` = "Mensaje", `submitLabel` = "Enviar",
`loadingLabel` = "Enviando...", `successMessage` = "¡Mensaje enviado! Pronto nos pondremos en contacto.", `errorMessage` = "Error al enviar. Intenta de nuevo.". Envía a `POST /storefront/contact`.

### `collection-hero` — cabecera de `app/collections/[handle]/page.tsx`
Título, imagen y SEO salen de la colección (`GET /storefront/collections/:handle`: `title`, `image`, `seo`); esta sección aporta el resto.
Settings: `eyebrow?` ("Colección"; + " — NN piezas" si `showCount`), `showCount` = true, `countLabel` = "piezas", `imageUrl?` (foto de respaldo), `grayscale` = true, `parallax` = true,
`minHeight` "medium"|"large" = "medium", `overlayColor` = "#000000", `overlayOpacity` = 0.4, `showTabs` = true, `tabsLabel` = "Colecciones".
Bloques (máx. 8): `tab` → `{ label (1–40), collectionHandle }` (pestañas "Todo/Men/Women").

### `product-grid` — `ProductGrid` + `FilterBar` + `CollectionView`
| Setting | Tipo |
| --- | --- |
| `source` | "current-collection" \| "related" \| "collection" = "current-collection" |
| `collectionHandle?` | handle (si `source` = "collection") |
| `eyebrow?`, `heading?` | strings (bloque "Te puede interesar") |
| `limit` | 1–24 = 24 |
| `columns` | "3" \| "4" = "4" |
| `showFilters` | boolean = true (barra Availability / Price / Ordenar) |
| `srHeading?` | string (h2 solo lectores de pantalla, "Productos") |
| `filterLabel` "Filtrar", `availabilityLabel` "Availability", `priceLabel` "Price", `sortLabel` "Ordenar", `optionAllLabel` "Todos", `optionInStockLabel` "En stock", `optionSoldOutLabel` "Agotado", `sortFeaturedLabel` "Destacado", `sortPriceAscLabel` "Precio: menor a mayor", `sortPriceDescLabel` "Precio: mayor a menor", `resetLabel` "Limpiar filtros", `countLabel` "artículos", `emptyTitle` "Sin resultados", `emptyText` "Prueba con otro filtro", `soldOutBadgeLabel` "Agotado", `saleBadgeLabel` "Oferta" | string ≤80 (`emptyText` ≤200) |

### `product-detail` — `ProductInfo`, `StickyAddToCart`
Settings: `breadcrumbHomeLabel` "Inicio", `breadcrumbCollectionLabel` "Clothes", `breadcrumbCollectionHandle` "all", `sizeLabel` "Talla", `quantityLabel` "Cantidad", `maxQuantity` 1–50 = 10,
`addToCartLabel` "Añadir al carrito", `soldOutLabel` "Agotado", `saleBadgeLabel` "Oferta", `noPriceLabel` "Precio no disponible", `sizeRequiredMessage` "Selecciona una talla",
`stickyAddLabel` "Añadir", `stickyChooseSizeLabel` "Elegir talla", `showDiscountBadge` = true, `stickyAddToCart` = true.
Los datos del producto (título, precio, tallas = opción "Talla", descripción, imágenes) vienen de `GET /storefront/products/:handle`.

### `search-panel` — `components/search/SearchPanel.tsx`, `SearchSuggestions.tsx`
Settings: `title` "Buscar", `placeholder` "¿Qué buscas?", `closeLabel` "Cerrar", `suggestionsTitle` "Sugerencias", `popularTitle` "Más buscado", `resultsLabel` "Resultados", `resultSingular` "resultado", `resultPlural` "resultados",
`noResultsTitle` "Sin resultados para «{query}»" (`{query}` = texto buscado), `noResultsText`, `popularLimit` 1–12 = 4.
Bloques (máx. 8): `suggestion` → `{ label, url }`.

### `cart-drawer` — `components/layout/CartDrawer.tsx`
Settings: `title` "Carrito", `closeLabel` "Cerrar", `emptyTitle` "Tu carrito está vacío", `emptyText` "¿Tienes una cuenta? Inicia sesión para pagar más rápido.",
`emptyTextHighlight?` ("Inicia sesión": subcadena subrayada que abre el panel de cuenta), `continueLabel` "Seguir comprando", `checkoutLabel` "Finalizar compra", `checkoutHref` "/checkout",
`subtotalLabel` "Subtotal", `sizeLabel` "Talla", `removeLabel` "Eliminar", `decreaseLabel` "Quitar una unidad", `increaseLabel` "Añadir una unidad".

### `error-hero` — `app/not-found.tsx`
Settings: `eyebrow?` ("Error"), `code` (1–10 caracteres, "404": el front dibuja primer y último carácter con trazo y el del medio en color de acento), `ariaLabel?`.

### `rich-text` — texto libre (páginas)
Settings: `heading?`, `body` (Markdown ≤5000), `alignment` = "left", `maxWidth` "narrow"|"normal"|"wide" = "normal".

## Catálogo demo

`yarn catalog:seed` crea los 9 productos del front (handle, título, descripción, vendor "Daregular Dept.", tipo, etiquetas, opción "Talla" S/M/L/XL con 4 variantes, precio COP, imágenes `/images/...`),
los publica y crea las colecciones `all`, `men`, `women` (manuales, publicadas, con imagen de portada `/images/collection-*.jpg` y SEO "Clothes — Todo|Men|Women"). Stock 10 por variante en la ubicación por defecto ("Bogotá" si no existe);
`out-of-stock-product` queda sin stock (el front lo muestra "Agotado") y `take-the-risk-boxy-fit` lleva `compareAtPrice` 180000 (oferta).
