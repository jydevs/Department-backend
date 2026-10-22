import { z } from "zod";
import { handleSlug, hexColor, markdownText, nodeId, safeImageUrl, safeLinkUrl } from "../schemas/common";

/** Issue path is relative to the section (e.g. `settings.title`, `blocks.2.settings.text`). */
export interface SectionIssue {
  path: string;
  message: string;
}

/** Raw section shape (generic envelope; `settings`/`blocks` are validated against the registry). */
export const sectionEnvelopeSchema = z
  .object({
    id: nodeId,
    type: z.string().min(1).max(40),
    enabled: z.boolean(),
    settings: z.record(z.string(), z.unknown()),
    blocks: z
      .array(
        z
          .object({
            id: nodeId,
            type: z.string().min(1).max(40),
            settings: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

export type Section = z.infer<typeof sectionEnvelopeSchema>;

export interface BlockTypeDefinition {
  label: string;
  /** Schema of the block's `settings`. */
  schema: z.ZodType;
}

export interface SectionTypeDefinition {
  label: string;
  settings: z.ZodType;
  blockTypes: Record<string, BlockTypeDefinition>;
  maxBlocks?: number;
}

// ---- shared field builders --------------------------------------------------
/** Headings may contain "\n" (one line per row in the storefront's masked line reveal). No HTML, no Markdown. */
const title = z.string().max(300);
const body = z.string().max(300);
const cta = z.string().max(60);
const label = z.string().max(80);
const alignment = z.enum(["left", "center", "right"]);
const link = safeLinkUrl;
const image = safeImageUrl;
const alt = z.string().max(300);
const markdown = markdownText(5000); // Markdown only: no raw HTML, safe link destinations
const maxItems = z.number().int().min(1).max(24);
/** DOM id used as an in-page anchor target (`#new-arrivals`). */
const anchorId = z.string().regex(/^[a-z0-9-]{1,40}$/, "Id de ancla inválido (^[a-z0-9-]{1,40}$)");
const buttonVariant = z.enum(["solid", "outline", "red"]);
const columnCount = z.enum(["2", "3", "4"]);

const s = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const linkItem = s({ label: z.string().min(1).max(60), url: link });

/** Texts of the product cards (badges, missing price, quick add). Shared by every section that renders a product grid. */
const productCardLabels = {
  soldOutBadgeLabel: label.default("Agotado"),
  saleBadgeLabel: label.default("Oferta"),
  noPriceLabel: label.default("Precio no disponible"),
  quickAddLabel: label.default("Añadir rápido"),
};

// ---- registry ---------------------------------------------------------------
export const SECTION_REGISTRY = {
  "announcement-bar": {
    label: "Barra de anuncio",
    settings: s({
      text: title,
      /** Optional ticker lines. When present the storefront scrolls them as a marquee instead of `text`. */
      items: z.array(z.string().min(1).max(120)).max(10).optional(),
      href: link.optional(),
      backgroundColor: hexColor.optional(),
      textColor: hexColor.optional(),
      dismissible: z.boolean().default(false),
    }),
    blockTypes: {},
  },
  "site-header": {
    label: "Cabecera del sitio",
    settings: s({
      /** Key of the `menu` document that feeds the navigation (default `main`). */
      menuKey: handleSlug.default("main"),
      logoVariant: z.enum(["red", "black"]).default("red"),
      showAnnouncement: z.boolean().default(true),
      showSearch: z.boolean().default(true),
      showAccount: z.boolean().default(true),
      showCart: z.boolean().default(true),
      /** Superscript product count next to the link that points to the `all` collection. */
      showProductCount: z.boolean().default(true),
      /** Header starts transparent over full-bleed hero pages (home, collections). */
      transparentOnHero: z.boolean().default(true),
      homeAriaLabel: label.default("Daregular Dept. — inicio"),
      searchLabel: label.default("Buscar"),
      accountLabel: label.default("Cuenta"),
      cartLabel: label.default("Carrito"),
      menuOpenLabel: label.default("Abrir menú"),
      menuCloseLabel: label.default("Cerrar menú"),
      navLabel: label.default("Principal"),
      mobileMenuLabel: label.default("Menú"),
      /** Small text at the bottom of the mobile menu. Falls back to brand.tagline. */
      mobileMenuTagline: z.string().max(120).optional(),
      skipLinkLabel: label.default("Saltar al contenido"),
    }),
    blockTypes: {},
  },
  hero: {
    label: "Hero",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      /** Lines separated by "\n". */
      heading: title,
      /** Appended after the last heading line in the accent colour (e.g. "."). */
      headingAccent: z.string().max(10).optional(),
      subheading: body.optional(),
      imageUrl: image,
      imageAlt: alt.optional(),
      mobileImageUrl: image.optional(),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      secondaryCtaLabel: cta.optional(),
      secondaryCtaHref: link.optional(),
      /** Strength (0-1) of the legibility gradient painted over the photo. */
      overlayOpacity: z.number().min(0).max(1).default(0.2),
      overlayColor: hexColor.default("#000000"),
      alignment: alignment.default("left"),
      height: z.enum(["medium", "large", "full"]).default("large"),
      /** Slow push-in animation on the photograph. */
      kenBurns: z.boolean().default(true),
      scrollLabel: z.string().max(40).optional(),
      /** `id` of the section the "scroll" cue jumps to (no `#`). */
      scrollTargetId: anchorId.optional(),
    }),
    blockTypes: {},
  },
  marquee: {
    label: "Marquesina de texto",
    settings: s({
      speed: z.enum(["slow", "normal", "fast"]).default("normal"),
      /** Seconds per loop; overrides `speed` when set. */
      duration: z.number().min(5).max(180).optional(),
      /** band = coloured strip, outline = outlined type on the page background, plain = plain type. */
      variant: z.enum(["band", "outline", "plain"]).default("band"),
      size: z.enum(["sm", "md", "lg"]).default("md"),
      separator: z.string().max(5).optional(),
      separatorColor: hexColor.optional(),
      bordered: z.boolean().default(false),
      ariaLabel: z.string().max(120).optional(),
      backgroundColor: hexColor.optional(),
      textColor: hexColor.optional(),
    }),
    blockTypes: {
      item: { label: "Texto", schema: s({ text: z.string().min(1).max(120) }) },
    },
    maxBlocks: 20,
  },
  "new-arrivals": {
    label: "Novedades (banner con foto)",
    settings: s({
      /** "01 — Nuevos ingresos"; the storefront appends " · NN piezas" when showCount is on. */
      eyebrow: z.string().max(100).optional(),
      heading: title,
      /** Second heading line, drawn as outlined type. */
      headingOutline: z.string().max(100).optional(),
      subheading: body.optional(),
      imageUrl: image.optional(),
      imageAlt: alt.optional(),
      overlayColor: hexColor.default("#000000"),
      overlayOpacity: z.number().min(0).max(1).default(0.9),
      parallax: z.boolean().default(true),
      /** Collection whose size feeds the piece counter and the CTA target. */
      collectionHandle: handleSlug.optional(),
      showCount: z.boolean().default(true),
      countLabel: z.string().max(30).default("piezas"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      /** DOM id so other sections (hero scroll cue) can link to it. */
      anchorId: anchorId.optional(),
    }),
    blockTypes: {},
  },
  "split-banner": {
    label: "Banner dividido (colecciones)",
    settings: s({
      ariaLabel: z.string().max(120).optional(),
      showCount: z.boolean().default(true),
      countLabel: z.string().max(30).default("piezas"),
      /** Prefix each tile with its ordinal ("01 —"). */
      numbered: z.boolean().default(true),
      backgroundColor: hexColor.optional(),
      // legacy single-banner mode (used when there are no tile blocks)
      heading: title.optional(),
      text: body.optional(),
      imageUrl: image.optional(),
      imageAlt: alt.optional(),
      imagePosition: z.enum(["left", "right"]).default("left"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
    }),
    blockTypes: {
      tile: {
        label: "Mosaico",
        schema: s({
          label: z.string().min(1).max(60),
          imageUrl: image,
          imageAlt: alt.optional(),
          collectionHandle: handleSlug.optional(),
          href: link.optional(),
          ariaLabel: z.string().max(120).optional(),
        }).refine((v) => v.collectionHandle !== undefined || v.href !== undefined, {
          message: "Indique collectionHandle o href",
          path: ["collectionHandle"],
        }),
      },
    },
    maxBlocks: 4,
  },
  "value-props": {
    label: "Propuestas de valor",
    settings: s({
      heading: title.optional(),
      columns: columnCount.default("3"),
      ariaLabel: z.string().max(120).optional(),
      showNumbers: z.boolean().default(true),
    }),
    blockTypes: {
      item: {
        label: "Ítem",
        schema: s({
          icon: z.enum(["truck", "shield", "refresh", "credit-card", "heart", "star", "gift", "chat", "leaf", "clock", "eye", "user", "tag"]),
          title: z.string().min(1).max(80),
          text: body,
        }),
      },
    },
    maxBlocks: 8,
  },
  campaign: {
    label: "Campaña (cuadrícula de productos)",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      heading: title,
      /** Second heading line, drawn as outlined type. */
      headingOutline: z.string().max(100).optional(),
      text: body.optional(),
      imageUrl: image.optional(),
      imageAlt: alt.optional(),
      collectionHandle: handleSlug.optional(),
      limit: maxItems.default(6),
      columns: z.enum(["3", "4"]).default("3"),
      showCount: z.boolean().default(true),
      countLabel: z.string().max(30).default("piezas"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      ctaVariant: buttonVariant.default("outline"),
      alignment: alignment.default("center"),
      ...productCardLabels,
    }),
    blockTypes: {},
  },
  editorial: {
    label: "Editorial / manifiesto",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      /** Lines separated by "\n". */
      heading: title,
      /** Large first paragraph. */
      lede: body.optional(),
      /** Remaining copy (Markdown; blank line = new paragraph). */
      body: markdown,
      imageUrl: image.optional(),
      imageAlt: alt.optional(),
      /** Red tag stuck to the photo corner. */
      imageBadge: z.string().max(60).optional(),
      layout: z.enum(["text-only", "image-left", "image-right"]).default("image-right"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      ctaVariant: buttonVariant.default("red"),
    }),
    blockTypes: {},
  },
  lookbook: {
    label: "Lookbook",
    settings: s({
      heading: title.optional(),
      layout: z.enum(["grid", "carousel", "masonry"]).default("grid"),
      /** Desktop columns (mobile is always 2). */
      columns: columnCount.default("3"),
      showCaptions: z.boolean().default(true),
      ariaLabel: z.string().max(120).optional(),
    }),
    blockTypes: {
      photo: {
        label: "Foto",
        schema: s({
          imageUrl: image,
          alt: alt,
          caption: z.string().max(200).optional(),
          productHandle: handleSlug.optional(),
          /** Crop of the tile (width/height). */
          aspect: z.enum(["1/1", "2/3", "3/4", "4/5"]).default("2/3"),
        }),
      },
    },
    maxBlocks: 24,
  },
  newsletter: {
    label: "Boletín",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      heading: title,
      text: body.optional(),
      placeholder: z.string().max(80).default("Tu correo"),
      /** Visually hidden <label> of the e-mail input. */
      inputLabel: z.string().max(80).optional(),
      /** Text / aria-label of the submit button. */
      buttonLabel: cta.default("Suscribirme"),
      loadingMessage: z.string().max(100).optional(),
      successMessage: z.string().max(200).optional(),
      errorMessage: z.string().max(200).optional(),
      backgroundColor: hexColor.optional(),
    }),
    blockTypes: {},
  },
  "rich-text": {
    label: "Texto enriquecido",
    settings: s({
      heading: title.optional(),
      body: markdown,
      alignment: alignment.default("left"),
      maxWidth: z.enum(["narrow", "normal", "wide"]).default("normal"),
    }),
    blockTypes: {},
  },
  footer: {
    label: "Pie de página",
    settings: s({
      /** Legacy flag: render the newsletter band inside the footer. Prefer a separate `newsletter` section. */
      showNewsletter: z.boolean().default(false),
      showSocial: z.boolean().default(true),
      /** Big statement in the brand column (e.g. the tagline). */
      brandTitle: z.string().max(200).optional(),
      brandText: z.string().max(500).optional(),
      /** Giant decorative wordmark at the bottom. Falls back to brand.name. */
      wordmark: z.string().max(60).optional(),
      showWordmark: z.boolean().default(true),
      copyright: z.string().max(200).optional(),
      /** Second item of the bottom bar (e.g. "Colombia · COP"). */
      bottomText: z.string().max(120).optional(),
      backToTopLabel: z.string().max(60).optional(),
      backgroundColor: hexColor.optional(),
    }),
    blockTypes: {
      column: {
        label: "Columna de enlaces",
        schema: s({
          title: z.string().min(1).max(60),
          links: z.array(linkItem).max(12),
          /** When set, the column renders the items of that `menu` document instead of `links`. */
          menuKey: handleSlug.optional(),
        }),
      },
      "account-links": {
        label: "Columna de cuenta (acciones)",
        schema: s({
          title: z.string().min(1).max(60),
          accountLabel: z.string().max(60).default("Mi cuenta"),
          cartLabel: z.string().max(60).default("Carrito"),
        }),
      },
    },
    maxBlocks: 6,
  },
  "page-header": {
    label: "Cabecera de página",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      /** Lines separated by "\n". */
      heading: title,
      headingAccent: z.string().max(10).optional(),
      /** Display-size line under the heading (e.g. "Regular Members Only."). */
      lead: z.string().max(200).optional(),
      text: body.optional(),
      alignment: alignment.default("left"),
    }),
    blockTypes: {},
  },
  "cta-banner": {
    label: "Banner con llamada a la acción",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      heading: title.optional(),
      text: body.optional(),
      /** stacked = heading over buttons, split = text left / buttons right. */
      layout: z.enum(["stacked", "split"]).default("stacked"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      ctaVariant: buttonVariant.default("red"),
      secondaryCtaLabel: cta.optional(),
      secondaryCtaHref: link.optional(),
      secondaryCtaVariant: buttonVariant.default("outline"),
      backgroundColor: hexColor.optional(),
    }),
    blockTypes: {},
  },
  "contact-form": {
    label: "Formulario de contacto",
    settings: s({
      heading: title,
      showPhone: z.boolean().default(true),
      nameLabel: label.default("Nombre"),
      emailLabel: label.default("Email"),
      phoneLabel: label.default("Teléfono"),
      subjectLabel: label.default("Asunto"),
      messageLabel: label.default("Mensaje"),
      submitLabel: cta.default("Enviar"),
      loadingLabel: cta.default("Enviando..."),
      successMessage: z.string().max(200).default("¡Mensaje enviado! Pronto nos pondremos en contacto."),
      errorMessage: z.string().max(200).default("Error al enviar. Intenta de nuevo."),
    }),
    blockTypes: {},
  },
  "collection-hero": {
    label: "Cabecera de colección",
    settings: s({
      /** "Colección"; the storefront appends " — NN piezas" when showCount is on. */
      eyebrow: z.string().max(100).optional(),
      showCount: z.boolean().default(true),
      countLabel: z.string().max(30).default("piezas"),
      /** Fallback photo when the collection has no image of its own. */
      imageUrl: image.optional(),
      grayscale: z.boolean().default(true),
      parallax: z.boolean().default(true),
      minHeight: z.enum(["medium", "large"]).default("medium"),
      overlayColor: hexColor.default("#000000"),
      overlayOpacity: z.number().min(0).max(1).default(0.4),
      showTabs: z.boolean().default(true),
      tabsLabel: label.default("Colecciones"),
    }),
    blockTypes: {
      tab: { label: "Pestaña de colección", schema: s({ label: z.string().min(1).max(40), collectionHandle: handleSlug }) },
    },
    maxBlocks: 8,
  },
  "product-grid": {
    label: "Cuadrícula de productos",
    settings: s({
      /** current-collection = products of the collection page, related = "you may also like", collection = fixed `collectionHandle`. */
      source: z.enum(["current-collection", "related", "collection"]).default("current-collection"),
      collectionHandle: handleSlug.optional(),
      eyebrow: z.string().max(100).optional(),
      heading: title.optional(),
      limit: maxItems.default(24),
      columns: z.enum(["3", "4"]).default("4"),
      showFilters: z.boolean().default(true),
      srHeading: z.string().max(80).optional(),
      filterLabel: label.default("Filtrar"),
      availabilityLabel: label.default("Availability"),
      priceLabel: label.default("Price"),
      sortLabel: label.default("Ordenar"),
      optionAllLabel: label.default("Todos"),
      optionInStockLabel: label.default("En stock"),
      optionSoldOutLabel: label.default("Agotado"),
      sortFeaturedLabel: label.default("Destacado"),
      sortPriceAscLabel: label.default("Precio: menor a mayor"),
      sortPriceDescLabel: label.default("Precio: mayor a menor"),
      resetLabel: label.default("Limpiar filtros"),
      countLabel: label.default("artículos"),
      emptyTitle: label.default("Sin resultados"),
      emptyText: z.string().max(200).default("Prueba con otro filtro"),
      ...productCardLabels,
      /** "Ver más" button of a paginated collection, its loading text and its error. */
      loadMoreLabel: label.default("Ver más"),
      loadingMoreLabel: label.default("Cargando..."),
      loadMoreErrorLabel: z.string().max(200).default("No se pudo cargar. Inténtalo de nuevo."),
    }),
    blockTypes: {},
  },
  "product-detail": {
    label: "Detalle de producto",
    settings: s({
      breadcrumbHomeLabel: label.default("Inicio"),
      breadcrumbCollectionLabel: label.default("Clothes"),
      breadcrumbCollectionHandle: handleSlug.default("all"),
      sizeLabel: label.default("Talla"),
      quantityLabel: label.default("Cantidad"),
      maxQuantity: z.number().int().min(1).max(50).default(10),
      addToCartLabel: cta.default("Añadir al carrito"),
      soldOutLabel: cta.default("Agotado"),
      saleBadgeLabel: cta.default("Oferta"),
      noPriceLabel: label.default("Precio no disponible"),
      sizeRequiredMessage: label.default("Selecciona una talla"),
      stickyAddLabel: cta.default("Añadir"),
      stickyChooseSizeLabel: cta.default("Elegir talla"),
      showDiscountBadge: z.boolean().default(true),
      stickyAddToCart: z.boolean().default(true),
    }),
    blockTypes: {},
  },
  "search-panel": {
    label: "Panel de búsqueda",
    settings: s({
      title: label.default("Buscar"),
      placeholder: label.default("¿Qué buscas?"),
      closeLabel: label.default("Cerrar"),
      suggestionsTitle: label.default("Sugerencias"),
      popularTitle: label.default("Más buscado"),
      resultsLabel: label.default("Resultados"),
      resultSingular: label.default("resultado"),
      resultPlural: label.default("resultados"),
      /** `{query}` is replaced with the visitor's text. */
      noResultsTitle: z.string().max(200).default("Sin resultados para «{query}»"),
      noResultsText: z.string().max(200).default("Prueba con otro nombre o explora las colecciones."),
      popularLimit: z.number().int().min(1).max(12).default(4),
    }),
    blockTypes: {
      suggestion: { label: "Sugerencia", schema: s({ label: z.string().min(1).max(60), url: link }) },
    },
    maxBlocks: 8,
  },
  "cart-drawer": {
    label: "Carrito (panel lateral)",
    settings: s({
      title: label.default("Carrito"),
      closeLabel: label.default("Cerrar"),
      emptyTitle: label.default("Tu carrito está vacío"),
      emptyText: z.string().max(200).default("¿Tienes una cuenta? Inicia sesión para pagar más rápido."),
      /** Substring of emptyText that is underlined (it opens the account panel). */
      emptyTextHighlight: z.string().max(60).optional(),
      continueLabel: cta.default("Seguir comprando"),
      checkoutLabel: cta.default("Finalizar compra"),
      checkoutHref: link.default("/checkout"),
      subtotalLabel: label.default("Subtotal"),
      sizeLabel: label.default("Talla"),
      removeLabel: label.default("Eliminar"),
      decreaseLabel: label.default("Quitar una unidad"),
      increaseLabel: label.default("Añadir una unidad"),
      /** Line that can no longer be bought (deleted / unpublished product). */
      unavailableMessage: z.string().max(200).default("Ya no está disponible. Elimínalo para continuar."),
      discountLabel: label.default("Descuento"),
      shippingLabel: label.default("Envío"),
      shippingText: label.default("Se calcula al pagar"),
      taxLabel: label.default("IVA"),
      totalLabel: label.default("Total estimado"),
      /** Shown under the totals when prices already include VAT. */
      taxIncludedNote: z.string().max(200).default("Precios con IVA incluido. El envío se suma al elegir tu dirección."),
      discountCodeLabel: label.default("Código de descuento"),
      discountApplyLabel: cta.default("Aplicar"),
      discountApplyingLabel: cta.default("Aplicando…"),
      discountRemoveLabel: cta.default("Quitar"),
      discountEmptyMessage: z.string().max(200).default("Escribe tu código de descuento."),
    }),
    blockTypes: {},
  },
  "error-hero": {
    label: "Cabecera de error (404)",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      /** Big numerals; the storefront outlines the first/last characters and paints the middle one in the accent colour. */
      code: z.string().min(1).max(10),
      ariaLabel: z.string().max(60).optional(),
    }),
    blockTypes: {},
  },
} satisfies Record<string, SectionTypeDefinition>;

export type SectionTypeName = keyof typeof SECTION_REGISTRY;

const REGISTRY: Record<string, SectionTypeDefinition> = SECTION_REGISTRY;

function zodIssues(prefix: string, error: z.ZodError): SectionIssue[] {
  return error.issues.map((i) => ({
    path: [prefix, ...i.path.map(String)].filter((p) => p.length > 0).join("."),
    message: i.message,
  }));
}

/** Validates one section (envelope + type + settings + blocks). Returns [] when valid. Paths are relative to the section. */
export function validateSection(section: unknown): SectionIssue[] {
  const env = sectionEnvelopeSchema.safeParse(section);
  if (!env.success) return zodIssues("", env.error);
  const { type, settings, blocks } = env.data;
  const def = REGISTRY[type];
  if (!def) return [{ path: "type", message: `Tipo de sección desconocido: ${type}` }];

  const issues: SectionIssue[] = [];
  const parsed = def.settings.safeParse(settings);
  if (!parsed.success) issues.push(...zodIssues("settings", parsed.error));

  const list = blocks ?? [];
  if (def.maxBlocks !== undefined && list.length > def.maxBlocks) {
    issues.push({ path: "blocks", message: `Máximo ${def.maxBlocks} blocks en ${type}` });
  }
  const seen = new Set<string>();
  list.forEach((block, i) => {
    const base = `blocks.${i}`;
    if (seen.has(block.id)) issues.push({ path: `${base}.id`, message: "Id de block duplicado" });
    seen.add(block.id);
    const bdef = def.blockTypes[block.type];
    if (!bdef) {
      issues.push({ path: `${base}.type`, message: `Block "${block.type}" no permitido en ${type}` });
      return;
    }
    const bp = bdef.schema.safeParse(block.settings);
    if (!bp.success) issues.push(...zodIssues(`${base}.settings`, bp.error));
  });
  return issues;
}

export interface SectionTypeDescriptor {
  type: string;
  label: string;
  settingsSchema: Record<string, unknown>;
  blockTypes: { type: string; label: string; schema: Record<string, unknown> }[];
}

export function listSectionTypes(): SectionTypeDescriptor[] {
  return Object.entries(REGISTRY).map(([type, def]) => ({
    type,
    label: def.label,
    settingsSchema: z.toJSONSchema(def.settings),
    blockTypes: Object.entries(def.blockTypes).map(([bt, b]) => ({
      type: bt,
      label: b.label,
      schema: z.toJSONSchema(b.schema),
    })),
  }));
}
