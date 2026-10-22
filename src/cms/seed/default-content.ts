import type { DataSource } from "typeorm";
import { AuditLog } from "../../identity/entities";
import { ContentDocument, ContentVersion } from "../entities";
import type { ContentKind } from "../entities/content-document.entity";
import { parseDocument } from "../schemas";
import { LEGAL_DOCUMENTS, LEGAL_FOOTER_COLUMN } from "./legal-content";

/**
 * Default site content: a 1:1 transcription of what the Next.js storefront used to hard-code
 * (Daregular Dept.). Image paths are relative (`/images/...`) and point to the storefront's `public/` folder.
 *
 * Seeding is additive and idempotent: a document that already exists (even soft-deleted) is never touched,
 * so edits made in the admin always win.
 */

export interface SeedDocument {
  kind: ContentKind;
  key: string;
  title: string | null;
  data: Record<string, unknown>;
}

type Settings = Record<string, unknown>;
interface BlockSeed {
  id: string;
  type: string;
  settings: Settings;
}

const section = (id: string, type: string, settings: Settings, blocks?: BlockSeed[], enabled = true) => ({
  id,
  type,
  enabled,
  settings,
  ...(blocks ? { blocks } : {}),
});
const block = (id: string, type: string, settings: Settings): BlockSeed => ({ id, type, settings });

const SITE_NAME = "Daregular Dept.";
const TAGLINE = "Uniforms for the unnoticed.";
const LEDE = "Este proyecto es el primer lanzamiento oficial de Disruptive Dept, una marca que no diseña ropa, sino mensajes.";

// ── campos editables añadidos después del primer lanzamiento ─────────────────
// Tienen el mismo valor que la tienda mostraba fijo en el código; ensureEditableDefaults() los añade
// a las bases ya sembradas cuando faltan (ver ensure-editable-defaults.ts).

/** settings/site: logotipo dibujado, favicon y textura de grano. */
export const BRAND_EXTRA = { logoText: "Dept", faviconMediaUrl: "/favicon.svg" };
export const THEME_EXTRA = { grain: true };

/** Textos de las tarjetas de producto (product-grid y campaign). */
export const PRODUCT_CARD_LABELS = {
  soldOutBadgeLabel: "Agotado",
  saleBadgeLabel: "Oferta",
  noPriceLabel: "Precio no disponible",
  quickAddLabel: "Añadir rápido",
};

/** Botón «Ver más» de la colección paginada (product-grid). */
export const LOAD_MORE_LABELS = {
  loadMoreLabel: "Ver más",
  loadingMoreLabel: "Cargando...",
  loadMoreErrorLabel: "No se pudo cargar. Inténtalo de nuevo.",
};

/** Totales, aviso de producto no disponible y caja de descuento del carrito (cart-drawer). */
export const CART_EXTRA_LABELS = {
  unavailableMessage: "Ya no está disponible. Elimínalo para continuar.",
  discountLabel: "Descuento",
  shippingLabel: "Envío",
  shippingText: "Se calcula al pagar",
  taxLabel: "IVA",
  totalLabel: "Total estimado",
  taxIncludedNote: "Precios con IVA incluido. El envío se suma al elegir tu dirección.",
  discountCodeLabel: "Código de descuento",
  discountApplyLabel: "Aplicar",
  discountApplyingLabel: "Aplicando…",
  discountRemoveLabel: "Quitar",
  discountEmptyMessage: "Escribe tu código de descuento.",
};

// ── settings/site ────────────────────────────────────────────────────────────
const siteSettings = {
  brand: { name: SITE_NAME, tagline: TAGLINE, description: LEDE, ...BRAND_EXTRA },
  theme: {
    colors: {
      background: "#000000",
      foreground: "#ffffff",
      accent: "#e10e0e",
      muted: "#8a8a8a",
      border: "#1a1a1a",
      accentDark: "#7c0d0d",
      accentLight: "#ff5a52",
      info: "#4f7bd6",
      gray100: "#f2f2f2",
      gray300: "#cfcfcf",
      gray500: "#8a8a8a",
      gray900: "#141414",
    },
    fonts: { heading: "Anton", body: "Inter", condensed: "Oswald", script: "Pinyon Script" },
    colorScheme: "dark",
    ...THEME_EXTRA,
  },
  seo: {
    titleTemplate: "%s — Daregular Dept.",
    defaultTitle: "Daregular Dept. — Uniforms for the unnoticed",
    defaultDescription: "Uniforms for the unnoticed. Rags to Riches — Extended Version: ropa que no diseña ropa, sino mensajes.",
  },
  social: {},
  announcement: {
    enabled: true,
    text: "Rags to Riches — Extended Version",
    items: ["Rags to Riches — Extended Version", "Uniforms for the unnoticed", "Regular members only", "Precios en COP"],
    backgroundColor: "#e10e0e",
    textColor: "#ffffff",
    duration: 38,
  },
  store: { currency: "COP", locale: "es-CO" },
};

// ── menus ────────────────────────────────────────────────────────────────────
const mainMenu = {
  items: [
    { id: "nav-home", label: "Home", link: { type: "url", url: "/" } },
    {
      id: "nav-clothes",
      label: "Clothes",
      link: { type: "collection", handle: "all" },
      children: [
        { id: "nav-men", label: "Men", link: { type: "collection", handle: "men" } },
        { id: "nav-women", label: "Women", link: { type: "collection", handle: "women" } },
      ],
    },
    { id: "nav-community", label: "Community", link: { type: "page", handle: "community" } },
  ],
};

const footerMenu = {
  items: [
    { id: "foot-home", label: "Home", link: { type: "url", url: "/" } },
    { id: "foot-clothes", label: "Clothes", link: { type: "collection", handle: "all" } },
    { id: "foot-men", label: "Men", link: { type: "collection", handle: "men" } },
    { id: "foot-women", label: "Women", link: { type: "collection", handle: "women" } },
  ],
};

// ── templates ────────────────────────────────────────────────────────────────
const layoutTemplate = {
  sections: [
    section("site-header", "site-header", {
      menuKey: "main",
      logoVariant: "red",
      showAnnouncement: true,
      showSearch: true,
      showAccount: true,
      showCart: true,
      showProductCount: true,
      transparentOnHero: true,
      homeAriaLabel: "Daregular Dept. — inicio",
      searchLabel: "Buscar",
      accountLabel: "Cuenta",
      cartLabel: "Carrito",
      menuOpenLabel: "Abrir menú",
      menuCloseLabel: "Cerrar menú",
      navLabel: "Principal",
      mobileMenuLabel: "Menú",
      mobileMenuTagline: TAGLINE,
      skipLinkLabel: "Saltar al contenido",
    }),
    section("newsletter", "newsletter", {
      eyebrow: "Newsletter",
      heading: "Únete a Regular Members Only.",
      placeholder: "Dirección de correo electrónico",
      inputLabel: "Dirección de correo electrónico",
      buttonLabel: "Suscribirse",
      loadingMessage: "Enviando...",
      successMessage: "Gracias por suscribirte.",
      errorMessage: "Introduce un correo válido.",
    }),
    section(
      "site-footer",
      "footer",
      {
        showNewsletter: false,
        showSocial: true,
        brandTitle: TAGLINE,
        brandText: LEDE,
        wordmark: SITE_NAME,
        showWordmark: true,
        copyright: "© 2026 Daregular Dept.",
        bottomText: "Colombia · COP",
        backToTopLabel: "Volver arriba",
      },
      [
        block("col-shop", "column", { title: "Tienda", links: [], menuKey: "footer" }),
        block("col-community", "column", { title: "Comunidad", links: [{ label: "Community", url: "/pages/community" }, { label: "Contacto", url: "/pages/contact" }] }),
        block("col-account", "account-links", { title: "Cuenta", accountLabel: "Mi cuenta", cartLabel: "Carrito" }),
        LEGAL_FOOTER_COLUMN,
      ],
    ),
  ],
};

const homeTemplate = {
  sections: [
    section("home-hero", "hero", {
      eyebrow: "Rags to Riches — Extended Version",
      heading: "Uniforms for\nthe unnoticed",
      headingAccent: ".",
      imageUrl: "/images/home-hero.jpg",
      imageAlt: "Lookbook Rags to Riches — cuatro amigas con la camiseta All We Need Is Baddies, de noche",
      ctaLabel: "Ver colección",
      ctaHref: "/collections/all",
      secondaryCtaLabel: "Lookbook",
      secondaryCtaHref: "/pages/community",
      overlayOpacity: 0.85,
      overlayColor: "#000000",
      alignment: "left",
      height: "full",
      kenBurns: true,
      scrollLabel: "Scroll",
      scrollTargetId: "new-arrivals",
    }),
    section(
      "home-marquee",
      "marquee",
      {
        speed: "slow",
        duration: 46,
        variant: "band",
        size: "lg",
        separatorColor: "#e10e0e",
        ariaLabel: "Uniforms for the unnoticed",
        backgroundColor: "#ffffff",
        textColor: "#000000",
      },
      ["Uniforms for the unnoticed", "Rags to Riches", "Regular members only", "Extended Version"].map((text, i) =>
        block(`marquee-item-${i + 1}`, "item", { text }),
      ),
    ),
    section("new-arrivals", "new-arrivals", {
      eyebrow: "01 — Nuevos ingresos",
      heading: "New",
      headingOutline: "Arrivals",
      subheading: "We were not born to follow rules, but to rewrite them.",
      imageUrl: "/images/community-02.jpg",
      imageAlt: "Lookbook — pareja con hoodies 404 frente a una persiana metálica",
      overlayColor: "#000000",
      overlayOpacity: 0.9,
      parallax: true,
      collectionHandle: "all",
      showCount: true,
      countLabel: "piezas",
      ctaLabel: "Ver novedades",
      ctaHref: "/collections/all",
      anchorId: "new-arrivals",
    }),
    section(
      "home-collections",
      "split-banner",
      { ariaLabel: "Colecciones", showCount: true, countLabel: "piezas", numbered: true },
      [
        block("tile-women", "tile", {
          label: "Women",
          imageUrl: "/images/banner-women.jpg",
          imageAlt: "Colección Women — mujer de pie frente a un muro con grafiti",
          collectionHandle: "women",
          ariaLabel: "Ver colección Women",
        }),
        block("tile-men", "tile", {
          label: "Men",
          imageUrl: "/images/banner-men.jpg",
          imageAlt: "Colección Men — grupo posando frente a un muro",
          collectionHandle: "men",
          ariaLabel: "Ver colección Men",
        }),
      ],
    ),
    section("home-campaign", "campaign", {
      eyebrow: "02 — Campaña",
      heading: "Rags to Riches",
      headingOutline: "Extended Version",
      collectionHandle: "all",
      limit: 6,
      columns: "3",
      showCount: true,
      countLabel: "piezas",
      ctaLabel: "Ver todo",
      ctaHref: "/collections/all",
      ctaVariant: "outline",
      alignment: "left",
      ...PRODUCT_CARD_LABELS,
    }),
    section("home-editorial", "editorial", {
      eyebrow: "03 — Manifiesto",
      heading: "Rags to Riches –\nExtended Version",
      lede: LEDE,
      body:
        "Rags to Riches es más que un drop, es una declaración de principios. Representa el viaje del barrio al brillo. De las apuestas sin respaldo, al respeto ganado a pulso.\n\n" +
        "La colección se inspira en la transición real y emocional de quienes han tenido que moverse con hambre, callar con rabia y vestirse con lo que hay hasta poder elegir qué ponerse, cómo hablar y cuándo romper todo.",
      imageUrl: "/images/editorial.jpg",
      imageAlt: "Lookbook — pareja sentada en unas escaleras, con camiseta DEPT y short 404",
      imageBadge: "Extended Version",
      layout: "image-left",
      ctaLabel: "Ver la colección",
      ctaHref: "/collections/all",
      ctaVariant: "red",
    }),
    section(
      "home-values",
      "value-props",
      { columns: "3", ariaLabel: "Valores", showNumbers: true },
      [
        block("value-1", "item", { icon: "eye", title: "Intentional Design", text: "Everything we do starts with why" }),
        block("value-2", "item", { icon: "heart", title: "Made With Care", text: "We believe in building better" }),
        block("value-3", "item", { icon: "user", title: "A Team With A Goal", text: "Real people making great products" }),
      ],
    ),
  ],
};

const collectionTemplate = {
  sections: [
    section(
      "collection-hero",
      "collection-hero",
      {
        eyebrow: "Colección",
        showCount: true,
        countLabel: "piezas",
        grayscale: true,
        parallax: true,
        minHeight: "medium",
        overlayColor: "#000000",
        overlayOpacity: 0.4,
        showTabs: true,
        tabsLabel: "Colecciones",
      },
      [
        block("tab-all", "tab", { label: "Todo", collectionHandle: "all" }),
        block("tab-men", "tab", { label: "Men", collectionHandle: "men" }),
        block("tab-women", "tab", { label: "Women", collectionHandle: "women" }),
      ],
    ),
    section("collection-grid", "product-grid", {
      source: "current-collection",
      limit: 24,
      columns: "4",
      showFilters: true,
      srHeading: "Productos",
      filterLabel: "Filtrar",
      availabilityLabel: "Availability",
      priceLabel: "Price",
      sortLabel: "Ordenar",
      optionAllLabel: "Todos",
      optionInStockLabel: "En stock",
      optionSoldOutLabel: "Agotado",
      sortFeaturedLabel: "Destacado",
      sortPriceAscLabel: "Precio: menor a mayor",
      sortPriceDescLabel: "Precio: mayor a menor",
      resetLabel: "Limpiar filtros",
      countLabel: "artículos",
      emptyTitle: "Sin resultados",
      emptyText: "Prueba con otro filtro",
      ...PRODUCT_CARD_LABELS,
      ...LOAD_MORE_LABELS,
    }),
  ],
};

const productTemplate = {
  sections: [
    section("product-detail", "product-detail", {
      breadcrumbHomeLabel: "Inicio",
      breadcrumbCollectionLabel: "Clothes",
      breadcrumbCollectionHandle: "all",
      sizeLabel: "Talla",
      quantityLabel: "Cantidad",
      maxQuantity: 10,
      addToCartLabel: "Añadir al carrito",
      soldOutLabel: "Agotado",
      saleBadgeLabel: "Oferta",
      noPriceLabel: "Precio no disponible",
      sizeRequiredMessage: "Selecciona una talla",
      stickyAddLabel: "Añadir",
      stickyChooseSizeLabel: "Elegir talla",
      showDiscountBadge: true,
      stickyAddToCart: true,
    }),
    section("product-related", "product-grid", {
      source: "related",
      eyebrow: "01 — Selección",
      heading: "Te puede interesar",
      limit: 4,
      columns: "4",
      showFilters: false,
      emptyTitle: "Sin resultados",
      emptyText: "Prueba con otro filtro",
      ...PRODUCT_CARD_LABELS,
    }),
  ],
};

const searchTemplate = {
  sections: [
    section(
      "search-panel",
      "search-panel",
      {
        title: "Buscar",
        placeholder: "¿Qué buscas?",
        closeLabel: "Cerrar",
        suggestionsTitle: "Sugerencias",
        popularTitle: "Más buscado",
        resultsLabel: "Resultados",
        resultSingular: "resultado",
        resultPlural: "resultados",
        noResultsTitle: "Sin resultados para «{query}»",
        noResultsText: "Prueba con otro nombre o explora las colecciones.",
        popularLimit: 4,
      },
      [
        block("sugg-all", "suggestion", { label: "Clothes", url: "/collections/all" }),
        block("sugg-men", "suggestion", { label: "Men", url: "/collections/men" }),
        block("sugg-women", "suggestion", { label: "Women", url: "/collections/women" }),
      ],
    ),
  ],
};

const cartTemplate = {
  sections: [
    section("cart-drawer", "cart-drawer", {
      title: "Carrito",
      closeLabel: "Cerrar",
      emptyTitle: "Tu carrito está vacío",
      emptyText: "¿Tienes una cuenta? Inicia sesión para pagar más rápido.",
      emptyTextHighlight: "Inicia sesión",
      continueLabel: "Seguir comprando",
      checkoutLabel: "Finalizar compra",
      checkoutHref: "/checkout",
      subtotalLabel: "Subtotal",
      sizeLabel: "Talla",
      removeLabel: "Eliminar",
      decreaseLabel: "Quitar una unidad",
      increaseLabel: "Añadir una unidad",
      ...CART_EXTRA_LABELS,
    }),
  ],
};

const notFoundTemplate = {
  sections: [
    section("error-hero", "error-hero", { eyebrow: "Error", code: "404", ariaLabel: "404" }),
    section(
      "error-marquee",
      "marquee",
      { speed: "fast", duration: 30, variant: "plain", size: "md", bordered: true },
      ["PÁGINA NO ENCONTRADA", "UNIFORMS FOR THE UNNOTICED", "404", "DAREGULAR DEPT."].map((text, i) =>
        block(`error-item-${i + 1}`, "item", { text }),
      ),
    ),
    section("error-cta", "cta-banner", {
      text: "Esta página no existe — o nunca la vieron.",
      layout: "split",
      ctaLabel: "Volver al inicio",
      ctaHref: "/",
      ctaVariant: "solid",
      secondaryCtaLabel: "Ver clothes",
      secondaryCtaHref: "/collections/all",
      secondaryCtaVariant: "outline",
    }),
  ],
};

// ── pages ────────────────────────────────────────────────────────────────────
/** Same crop rhythm the storefront used: alternating aspect ratios by position. */
const LOOKBOOK_ASPECTS = ["2/3", "4/5", "2/3", "3/4"] as const;

const lookbookPhotos = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  const num = String(n).padStart(2, "0");
  return block(`photo-${num}`, "photo", {
    imageUrl: `/images/community-${num}.jpg`,
    alt: `Lookbook Daregular Dept. — foto ${n}`,
    caption: `N°${num}`,
    aspect: LOOKBOOK_ASPECTS[(i * 3 + Math.floor(i / 4)) % LOOKBOOK_ASPECTS.length],
  });
});

const communityPage = {
  title: "Community",
  handle: "community",
  template: "page",
  seoTitle: "Community",
  sections: [
    section("community-header", "page-header", {
      eyebrow: "Comunidad",
      heading: "Daregular\nMembers",
      lead: "Regular Members Only.",
      text: "We were not born to follow rules, but to rewrite them.",
      alignment: "left",
    }),
    section("community-lookbook", "lookbook", { layout: "masonry", columns: "3", showCaptions: true, ariaLabel: "Lookbook" }, lookbookPhotos),
    section(
      "community-values",
      "marquee",
      { speed: "normal", duration: 35, variant: "outline", size: "md", bordered: true },
      ["INTENTIONAL DESIGN", "MADE WITH CARE", "A TEAM WITH A GOAL"].map((text, i) => block(`values-item-${i + 1}`, "item", { text })),
    ),
    section("community-cta", "cta-banner", {
      heading: "Únete a Regular Members Only.",
      layout: "stacked",
      ctaLabel: "Ver la colección",
      ctaHref: "/collections/all",
      ctaVariant: "red",
    }),
  ],
};

const contactPage = {
  title: "Contacto",
  handle: "contact",
  template: "page",
  seoTitle: "Contacto",
  sections: [
    section("contact-form", "contact-form", {
      heading: "Ponte en contacto",
      showPhone: true,
      nameLabel: "Nombre",
      emailLabel: "Email",
      phoneLabel: "Teléfono",
      subjectLabel: "Asunto",
      messageLabel: "Mensaje",
      submitLabel: "Enviar",
      loadingLabel: "Enviando...",
      successMessage: "¡Mensaje enviado! Pronto nos pondremos en contacto.",
      errorMessage: "Error al enviar. Intenta de nuevo.",
    }),
  ],
};

export const DEFAULT_DOCUMENTS: SeedDocument[] = [
  { kind: "settings", key: "site", title: "Ajustes del sitio", data: siteSettings },
  { kind: "menu", key: "main", title: "Menú principal", data: mainMenu },
  { kind: "menu", key: "footer", title: "Menú del pie de página", data: footerMenu },
  { kind: "template", key: "layout", title: "Plantilla: Cabecera y pie", data: layoutTemplate },
  { kind: "template", key: "home", title: "Plantilla: Inicio", data: homeTemplate },
  { kind: "template", key: "collection", title: "Plantilla: Colección", data: collectionTemplate },
  { kind: "template", key: "product", title: "Plantilla: Producto", data: productTemplate },
  { kind: "template", key: "search", title: "Plantilla: Búsqueda", data: searchTemplate },
  { kind: "template", key: "cart", title: "Plantilla: Carrito", data: cartTemplate },
  { kind: "template", key: "404", title: "Plantilla: Error 404", data: notFoundTemplate },
  { kind: "page", key: "community", title: "Community", data: communityPage },
  { kind: "page", key: "contact", title: "Contacto", data: contactPage },
  ...LEGAL_DOCUMENTS,
];

export interface SeedLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface SeedDefaultContentResult {
  created: string[];
  skipped: string[];
  /** documents that could not be written (the rest are still seeded) */
  failed: { document: string; error: string }[];
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { driverError?: { code?: string } })?.driverError?.code === "23505";
}

/**
 * Creates every default document that does not exist yet, each with a draft and a published version #1.
 * Never overwrites: existing documents (even soft-deleted ones) are skipped.
 */
export async function seedDefaultContent(
  dataSource: DataSource,
  opts: { logger?: SeedLogger; documents?: SeedDocument[] } = {},
): Promise<SeedDefaultContentResult> {
  const result: SeedDefaultContentResult = { created: [], skipped: [], failed: [] };
  const documents = opts.documents ?? DEFAULT_DOCUMENTS;

  // validate everything first: a bad default must fail loudly before touching the database
  const validated = documents.map((doc) => {
    const parsed = parseDocument(doc.kind, doc.key, doc.data);
    if (!parsed.ok) {
      const detail = parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new Error(`Default content ${doc.kind}/${doc.key} is invalid: ${detail}`);
    }
    return { doc, data: parsed.data };
  });

  for (const { doc, data } of validated) {
    const label = `${doc.kind}/${doc.key}`;
    try {
      const created = await dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(ContentDocument, { where: { kind: doc.kind, key: doc.key }, withDeleted: true });
        if (existing) return false;

        const now = new Date();
        const entity = manager.create(ContentDocument, {
          kind: doc.kind,
          key: doc.key,
          title: doc.title,
          draft: data,
          draftUpdatedAt: now,
          draftUpdatedBy: null,
          publishedVersionId: null,
        });
        await manager.save(entity);

        const version = manager.create(ContentVersion, {
          documentId: entity.id,
          number: 1,
          title: doc.kind === "page" ? null : doc.title,
          data,
          status: "published",
          publishAt: null,
          publishedAt: now,
          authorId: null,
          note: "Contenido inicial",
        });
        await manager.save(version);

        await manager.query(`UPDATE content_documents SET published_version_id = $2 WHERE id = $1`, [entity.id, version.id]);
        await manager.save(
          manager.create(AuditLog, {
            actorType: "system",
            actorId: null,
            action: "content:seed",
            entityType: "ContentDocument",
            entityId: entity.id,
            diff: { kind: doc.kind, key: doc.key, versionNumber: 1 },
          }),
        );
        return true;
      });
      (created ? result.created : result.skipped).push(label);
    } catch (err) {
      // another instance seeded the same document at the same time: that is fine
      if (isUniqueViolation(err)) result.skipped.push(label);
      else {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ document: label, error: message });
        opts.logger?.warn(`Default content ${label} was not seeded: ${message}`);
      }
    }
  }

  opts.logger?.log(`Default content: ${result.created.length} created, ${result.skipped.length} already present${result.failed.length > 0 ? `, ${result.failed.length} failed` : ""}`);
  return result;
}
