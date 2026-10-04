/**
 * Traducciones del contenido sembrado (scripts/seed-content.ts → src/cms/seed/default-content.ts y scripts/seed-catalog.ts).
 *
 * REGLA DE ORO: cada regla lleva el valor ORIGINAL sembrado (`from`). El script solo cambia un texto si el valor actual
 * es EXACTAMENTE ese; si el admin ya lo editó (o ya está traducido) no se toca.
 *
 * Criterio de traducción (decisiones documentadas en docs/CONTENIDO-INICIAL.md):
 *  - Se mantienen tal cual los nombres propios y de marca: "Daregular Dept.", "Rags to Riches", "Extended Version"
 *    (nombre de la campaña/colección), "Regular Members Only" (nombre del club/lema de comunidad), los nombres de producto.
 *  - "Lookbook" y "Newsletter" son términos de uso corriente en moda/marketing en español: se mantienen.
 *  - El lema "Uniforms for the unnoticed" se traduce como "Uniformes para los invisibles" (misma idea, corto y de marca).
 *  - Se traducen las etiquetas de navegación, valores y frases (incluidos marquees, SEO y textos de accesibilidad).
 */

export type Path = (string | number)[];

export interface TextRule {
  /** `kind/key` del documento del CMS. */
  doc: string;
  /**
   * Dónde está el ajuste:
   *  - sin `where`: raíz del documento (`settings/site`, o los campos `title`/`seoTitle` de una página)
   *  - `section`: ajustes de esa sección de la plantilla/página (por id de sección)
   *  - `section` + `block`: ajustes de ese bloque
   *  - `item`: ítem de menú (por id; `path` es relativo al ítem)
   */
  where?: { section?: string; block?: string; item?: string };
  path: Path;
  from: string;
  to: string;
}

const TAGLINE_FROM = "Uniforms for the unnoticed";
const TAGLINE_TO = "Uniformes para los invisibles";
const FOLLOW_RULES_FROM = "We were not born to follow rules, but to rewrite them.";
const FOLLOW_RULES_TO = "No nacimos para seguir reglas, sino para reescribirlas.";

const t = (doc: string, where: TextRule["where"], path: Path, from: string, to: string): TextRule => ({ doc, where, path, from, to });

export const TEXT_RULES: TextRule[] = [
  // ── settings/site ──
  t("settings/site", undefined, ["brand", "tagline"], `${TAGLINE_FROM}.`, `${TAGLINE_TO}.`),
  t("settings/site", undefined, ["seo", "defaultTitle"], `Daregular Dept. — ${TAGLINE_FROM}`, `Daregular Dept. — ${TAGLINE_TO}`),
  t(
    "settings/site",
    undefined,
    ["seo", "defaultDescription"],
    `${TAGLINE_FROM}. Rags to Riches — Extended Version: ropa que no diseña ropa, sino mensajes.`,
    `${TAGLINE_TO}. Rags to Riches — Extended Version: ropa que no diseña ropa, sino mensajes.`,
  ),
  t("settings/site", undefined, ["announcement", "items", 1], TAGLINE_FROM, TAGLINE_TO),

  // ── menús (cabecera y pie) ──
  t("menu/main", { item: "nav-home" }, ["label"], "Home", "Inicio"),
  t("menu/main", { item: "nav-clothes" }, ["label"], "Clothes", "Ropa"),
  t("menu/main", { item: "nav-men" }, ["label"], "Men", "Hombre"),
  t("menu/main", { item: "nav-women" }, ["label"], "Women", "Mujer"),
  t("menu/main", { item: "nav-community" }, ["label"], "Community", "Comunidad"),
  t("menu/footer", { item: "foot-home" }, ["label"], "Home", "Inicio"),
  t("menu/footer", { item: "foot-clothes" }, ["label"], "Clothes", "Ropa"),
  t("menu/footer", { item: "foot-men" }, ["label"], "Men", "Hombre"),
  t("menu/footer", { item: "foot-women" }, ["label"], "Women", "Mujer"),

  // ── plantilla layout (cabecera + pie) ──
  t("template/layout", { section: "site-header" }, ["mobileMenuTagline"], `${TAGLINE_FROM}.`, `${TAGLINE_TO}.`),
  t("template/layout", { section: "site-footer" }, ["brandTitle"], `${TAGLINE_FROM}.`, `${TAGLINE_TO}.`),
  t("template/layout", { section: "site-footer", block: "col-community" }, ["links", 0, "label"], "Community", "Comunidad"),

  // ── plantilla home ──
  // eyebrow "Rags to Riches — Extended Version": nombre de la campaña, se conserva.
  // secundaryCtaLabel "Lookbook": término de moda, se conserva.
  t("template/home", { section: "home-hero" }, ["heading"], "Uniforms for\nthe unnoticed", "Uniformes para\nlos invisibles"),
  t("template/home", { section: "home-hero" }, ["scrollLabel"], "Scroll", "Desliza"),
  t("template/home", { section: "home-marquee" }, ["ariaLabel"], TAGLINE_FROM, TAGLINE_TO),
  t("template/home", { section: "home-marquee", block: "marquee-item-1" }, ["text"], TAGLINE_FROM, TAGLINE_TO),
  t("template/home", { section: "new-arrivals" }, ["heading"], "New", "Nuevos"),
  t("template/home", { section: "new-arrivals" }, ["headingOutline"], "Arrivals", "Ingresos"),
  t("template/home", { section: "new-arrivals" }, ["subheading"], FOLLOW_RULES_FROM, FOLLOW_RULES_TO),
  t("template/home", { section: "home-collections", block: "tile-women" }, ["label"], "Women", "Mujer"),
  t("template/home", { section: "home-collections", block: "tile-women" }, ["ariaLabel"], "Ver colección Women", "Ver colección Mujer"),
  t(
    "template/home",
    { section: "home-collections", block: "tile-women" },
    ["imageAlt"],
    "Colección Women — mujer de pie frente a un muro con grafiti",
    "Colección Mujer — mujer de pie frente a un muro con grafiti",
  ),
  t("template/home", { section: "home-collections", block: "tile-men" }, ["label"], "Men", "Hombre"),
  t("template/home", { section: "home-collections", block: "tile-men" }, ["ariaLabel"], "Ver colección Men", "Ver colección Hombre"),
  t(
    "template/home",
    { section: "home-collections", block: "tile-men" },
    ["imageAlt"],
    "Colección Men — grupo posando frente a un muro",
    "Colección Hombre — grupo posando frente a un muro",
  ),
  t("template/home", { section: "home-values", block: "value-1" }, ["title"], "Intentional Design", "Diseño intencional"),
  t("template/home", { section: "home-values", block: "value-1" }, ["text"], "Everything we do starts with why", "Todo lo que hacemos empieza por el porqué"),
  t("template/home", { section: "home-values", block: "value-2" }, ["title"], "Made With Care", "Hecho con cuidado"),
  t("template/home", { section: "home-values", block: "value-2" }, ["text"], "We believe in building better", "Creemos en construir mejor"),
  t("template/home", { section: "home-values", block: "value-3" }, ["title"], "A Team With A Goal", "Un equipo con un objetivo"),
  t("template/home", { section: "home-values", block: "value-3" }, ["text"], "Real people making great products", "Gente real creando grandes productos"),

  // ── plantilla collection ──
  t("template/collection", { section: "collection-hero", block: "tab-men" }, ["label"], "Men", "Hombre"),
  t("template/collection", { section: "collection-hero", block: "tab-women" }, ["label"], "Women", "Mujer"),
  t("template/collection", { section: "collection-grid" }, ["availabilityLabel"], "Availability", "Disponibilidad"),
  t("template/collection", { section: "collection-grid" }, ["priceLabel"], "Price", "Precio"),

  // ── plantilla product ──
  t("template/product", { section: "product-detail" }, ["breadcrumbCollectionLabel"], "Clothes", "Ropa"),

  // ── plantilla search ──
  t("template/search", { section: "search-panel", block: "sugg-all" }, ["label"], "Clothes", "Ropa"),
  t("template/search", { section: "search-panel", block: "sugg-men" }, ["label"], "Men", "Hombre"),
  t("template/search", { section: "search-panel", block: "sugg-women" }, ["label"], "Women", "Mujer"),

  // ── plantilla 404 ──
  t("template/404", { section: "error-marquee", block: "error-item-2" }, ["text"], "UNIFORMS FOR THE UNNOTICED", "UNIFORMES PARA LOS INVISIBLES"),
  t("template/404", { section: "error-cta" }, ["secondaryCtaLabel"], "Ver clothes", "Ver ropa"),

  // ── página community (el handle `community` NO cambia: solo el título visible) ──
  t("page/community", undefined, ["title"], "Community", "Comunidad"),
  t("page/community", undefined, ["seoTitle"], "Community", "Comunidad"),
  // heading "Daregular\nMembers" y lead "Regular Members Only.": nombre del club y lema de marca, se conservan.
  t("page/community", { section: "community-header" }, ["text"], FOLLOW_RULES_FROM, FOLLOW_RULES_TO),
  t("page/community", { section: "community-values", block: "values-item-1" }, ["text"], "INTENTIONAL DESIGN", "DISEÑO INTENCIONAL"),
  t("page/community", { section: "community-values", block: "values-item-2" }, ["text"], "MADE WITH CARE", "HECHO CON CUIDADO"),
  t("page/community", { section: "community-values", block: "values-item-3" }, ["text"], "A TEAM WITH A GOAL", "UN EQUIPO CON UN OBJETIVO"),
];

/**
 * Colecciones del catálogo (entidad, no CMS): el seed de catálogo titula las tres "Clothes".
 * Los handles (all / men / women) NO cambian.
 */
export interface CollectionRule {
  handle: string;
  titleFrom: string;
  titleTo: string;
  seoTitleFrom: string;
  seoTitleTo: string;
}

export const COLLECTION_RULES: CollectionRule[] = [
  { handle: "all", titleFrom: "Clothes", titleTo: "Ropa", seoTitleFrom: "Clothes — Todo", seoTitleTo: "Ropa — Todo" },
  { handle: "men", titleFrom: "Clothes", titleTo: "Ropa hombre", seoTitleFrom: "Clothes — Men", seoTitleTo: "Ropa — Hombre" },
  { handle: "women", titleFrom: "Clothes", titleTo: "Ropa mujer", seoTitleFrom: "Clothes — Women", seoTitleTo: "Ropa — Mujer" },
];

export const TRANSLATION_NOTE = "Traducción automática del contenido sembrado";
