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
const title = z.string().max(300);
const body = z.string().max(300);
const cta = z.string().max(60);
const alignment = z.enum(["left", "center", "right"]);
const link = safeLinkUrl;
const image = safeImageUrl;
const alt = z.string().max(300);
const markdown = markdownText(5000); // Markdown only: no raw HTML, safe link destinations
const maxItems = z.number().int().min(1).max(24);

const s = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const linkItem = s({ label: z.string().min(1).max(60), url: link });

// ---- registry ---------------------------------------------------------------
export const SECTION_REGISTRY = {
  "announcement-bar": {
    label: "Barra de anuncio",
    settings: s({
      text: title,
      href: link.optional(),
      backgroundColor: hexColor.optional(),
      textColor: hexColor.optional(),
      dismissible: z.boolean().default(false),
    }),
    blockTypes: {},
  },
  hero: {
    label: "Hero",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      heading: title,
      subheading: body.optional(),
      imageUrl: image,
      imageAlt: alt.optional(),
      mobileImageUrl: image.optional(),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      secondaryCtaLabel: cta.optional(),
      secondaryCtaHref: link.optional(),
      overlayOpacity: z.number().min(0).max(1).default(0.2),
      alignment: alignment.default("left"),
      height: z.enum(["medium", "large", "full"]).default("large"),
    }),
    blockTypes: {},
  },
  marquee: {
    label: "Marquesina de texto",
    settings: s({
      speed: z.enum(["slow", "normal", "fast"]).default("normal"),
      backgroundColor: hexColor.optional(),
      textColor: hexColor.optional(),
    }),
    blockTypes: {
      item: { label: "Texto", schema: s({ text: z.string().min(1).max(120) }) },
    },
    maxBlocks: 20,
  },
  "new-arrivals": {
    label: "Novedades",
    settings: s({
      heading: title,
      subheading: body.optional(),
      collectionHandle: handleSlug,
      limit: maxItems.default(8),
      columns: z.enum(["2", "3", "4"]).default("4"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
    }),
    blockTypes: {},
  },
  "split-banner": {
    label: "Banner dividido",
    settings: s({
      heading: title,
      text: body.optional(),
      imageUrl: image,
      imageAlt: alt.optional(),
      imagePosition: z.enum(["left", "right"]).default("left"),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      backgroundColor: hexColor.optional(),
    }),
    blockTypes: {},
  },
  "value-props": {
    label: "Propuestas de valor",
    settings: s({
      heading: title.optional(),
      columns: z.enum(["2", "3", "4"]).default("3"),
    }),
    blockTypes: {
      item: {
        label: "Ítem",
        schema: s({
          icon: z.enum(["truck", "shield", "refresh", "credit-card", "heart", "star", "gift", "chat", "leaf", "clock"]),
          title: z.string().min(1).max(80),
          text: body,
        }),
      },
    },
    maxBlocks: 8,
  },
  campaign: {
    label: "Campaña",
    settings: s({
      eyebrow: z.string().max(100).optional(),
      heading: title,
      text: body.optional(),
      imageUrl: image,
      imageAlt: alt.optional(),
      collectionHandle: handleSlug.optional(),
      ctaLabel: cta.optional(),
      ctaHref: link.optional(),
      alignment: alignment.default("center"),
    }),
    blockTypes: {},
  },
  editorial: {
    label: "Editorial",
    settings: s({
      heading: title,
      body: markdown,
      imageUrl: image.optional(),
      imageAlt: alt.optional(),
      layout: z.enum(["text-only", "image-left", "image-right"]).default("image-right"),
    }),
    blockTypes: {},
  },
  lookbook: {
    label: "Lookbook",
    settings: s({
      heading: title.optional(),
      layout: z.enum(["grid", "carousel"]).default("grid"),
    }),
    blockTypes: {
      photo: {
        label: "Foto",
        schema: s({
          imageUrl: image,
          alt: alt,
          caption: z.string().max(200).optional(),
          productHandle: handleSlug.optional(),
        }),
      },
    },
    maxBlocks: 24,
  },
  newsletter: {
    label: "Boletín",
    settings: s({
      heading: title,
      text: body.optional(),
      placeholder: z.string().max(80).default("Tu correo"),
      buttonLabel: cta.default("Suscribirme"),
      successMessage: z.string().max(200).optional(),
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
      showNewsletter: z.boolean().default(false),
      showSocial: z.boolean().default(true),
      copyright: z.string().max(200).optional(),
      backgroundColor: hexColor.optional(),
    }),
    blockTypes: {
      column: {
        label: "Columna",
        schema: s({ title: z.string().min(1).max(60), links: z.array(linkItem).max(12) }),
      },
    },
    maxBlocks: 6,
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
