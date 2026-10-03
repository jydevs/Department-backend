import "reflect-metadata";
import { INestApplicationContext, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuditModule } from "../src/audit/audit.module";
import { CollectionsModule } from "../src/catalog/collections/collections.module";
import { CollectionsService } from "../src/catalog/collections/collections.service";
import { ContentModule } from "../src/cms/content/content.module";
import { ContentService } from "../src/cms/content/content.service";
import type { DocumentDetailDto } from "../src/cms/content/content.dto";
import { RevalidationService } from "../src/cms/content/revalidation.service";
import type { ContentKind } from "../src/cms/entities/content-document.entity";
import { ClockModule } from "../src/common/clock/clock";
import { AppConfigModule } from "../src/config/config.module";
import { loadDotEnv } from "../src/config/env";
import { normalizeDepartment } from "../src/commerce/pricing";
import { ShippingModule } from "../src/commerce/shipping/shipping.module";
import { ShippingService } from "../src/commerce/shipping/shipping.service";
import { buildLegalPages, findPlaceholders, type Business, type LegalPage, type ShippingZoneInfo } from "./complete-storefront/legal-pages";
import { COLLECTION_RULES, TEXT_RULES, TRANSLATION_NOTE, type TextRule } from "./complete-storefront/translations";

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 *  yarn content:complete — completa el contenido de la tienda recién sembrada (seed) con datos reales:
 *    1. translate  traduce al español los textos sembrados en inglés (solo si siguen siendo el valor original)
 *    2. footer     enlaza Contacto y las páginas legales en el pie de página
 *    3. legal      crea las páginas legales (borrador; con --publish-legal las publica)
 *    4. shipping   crea zonas y tarifas de envío para Colombia (solo lo que falte)
 *
 *  Uso:  DATABASE_URL=... yarn content:complete [--dry-run] [--publish-legal] [--only=translate|footer|legal|shipping]
 *  Es idempotente y NUNCA pisa lo que ya editó el admin. Detalles en docs/CONTENIDO-INICIAL.md.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */

/* ───────────────────────────── PARÁMETROS EDITABLES ───────────────────────────── */

/**
 * Datos del negocio que se insertan en las páginas legales. Mientras un campo conserve el marcador
 * `[COMPLETAR: ...]` la página lo muestra tal cual (y el script lo cuenta en el resumen). Se pueden rellenar aquí
 * antes de ejecutar o, después, editando las páginas en /admin/content/pages.
 */
const BUSINESS: Business = {
  razonSocial: "[COMPLETAR: razón social]",
  nit: "[COMPLETAR: NIT]",
  direccion: "[COMPLETAR: dirección]",
  ciudad: "[COMPLETAR: ciudad]",
  correo: "[COMPLETAR: correo de contacto]",
  telefono: "[COMPLETAR: teléfono]",
  sitioWeb: "[COMPLETAR: dominio de la tienda]",
  vigencia: "[COMPLETAR: fecha de vigencia]",
};

/** Envío gratis (subtotal con descuentos, en COP) en las tarifas "Estándar". `null` = sin envío gratis. */
const FREE_SHIPPING_OVER = 300_000;

/**
 * Departamentos de Colombia EXACTAMENTE como los envía el checkout de la tienda (Department-frontend: src/lib/geo.ts).
 * Si cambian allí, cámbialos aquí. La zona "Resto del país" se calcula como TODOS menos los de las otras zonas.
 */
const DEPARTMENTS = ["Amazonas","Antioquia","Arauca","Atlántico","Bogotá D.C.","Bolívar","Boyacá","Caldas","Caquetá","Casanare","Cauca","Cesar","Chocó","Córdoba","Cundinamarca","Guainía","Guaviare","Huila","La Guajira","Magdalena","Meta","Nariño","Norte de Santander","Putumayo","Quindío","Risaralda","San Andrés y Providencia","Santander","Sucre","Tolima","Valle del Cauca","Vaupés","Vichada"]; // prettier-ignore

interface RateParam {
  name: string;
  /** COP enteros. */
  price: number;
  minDays: number | null;
  maxDays: number | null;
  /** `null` = sin envío gratis. */
  freeOverSubtotal: number | null;
}
interface ZoneParam {
  name: string;
  /** Lista de departamentos o "REST" = el resto de departamentos no cubiertos por las demás zonas de esta lista. */
  departments: string[] | "REST";
  rates: RateParam[];
}

/** Zonas y tarifas a crear si no existen (por nombre). Nunca se modifica ni se borra nada existente: ajusta luego en /admin/shipping. */
const SHIPPING_ZONES: ZoneParam[] = [
  {
    name: "Bogotá y Cundinamarca",
    departments: ["Bogotá D.C.", "Cundinamarca"],
    rates: [
      { name: "Estándar", price: 9_000, minDays: 1, maxDays: 3, freeOverSubtotal: FREE_SHIPPING_OVER },
      { name: "Express", price: 15_000, minDays: 1, maxDays: 1, freeOverSubtotal: null },
    ],
  },
  {
    name: "Principales ciudades",
    departments: ["Antioquia", "Atlántico", "Valle del Cauca", "Santander", "Bolívar", "Risaralda", "Caldas", "Quindío"],
    rates: [{ name: "Estándar", price: 12_000, minDays: 2, maxDays: 5, freeOverSubtotal: FREE_SHIPPING_OVER }],
  },
  {
    name: "Resto del país",
    departments: "REST",
    rates: [{ name: "Estándar", price: 16_000, minDays: 3, maxDays: 7, freeOverSubtotal: FREE_SHIPPING_OVER }],
  },
];

/* ───────────────────────────── ARGUMENTOS ───────────────────────────── */

const STEPS = ["translate", "footer", "legal", "shipping"] as const;
type Step = (typeof STEPS)[number];

interface Options {
  dryRun: boolean;
  publishLegal: boolean;
  only: Set<Step>;
}

const HELP = `yarn content:complete [opciones]

  --dry-run          muestra qué haría sin escribir nada
  --publish-legal    publica las páginas legales (por defecto quedan en BORRADOR)
  --only=<paso>      ejecuta solo ese paso (translate | footer | legal | shipping); se puede repetir o separar por comas
  --help             esta ayuda

La base de datos se toma de DATABASE_URL (variable de entorno o .env).`;

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { dryRun: false, publishLegal: false, only: new Set() };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return null;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--publish-legal") opts.publishLegal = true;
    else if (arg.startsWith("--only=")) {
      for (const raw of arg.slice("--only=".length).split(",")) {
        const step = raw.trim() as Step;
        if (!STEPS.includes(step)) throw new Error(`--only desconocido: "${raw}". Valores válidos: ${STEPS.join(", ")}`);
        opts.only.add(step);
      }
    } else throw new Error(`Opción desconocida: ${arg}\n\n${HELP}`);
  }
  if (opts.only.size === 0) for (const s of STEPS) opts.only.add(s);
  return opts;
}

/* ───────────────────────────── SALIDA ───────────────────────────── */

type Status = "creado" | "actualizado" | "omitido" | "ya existía" | "aviso" | "error" | "simulado";
const TAG: Record<Status, string> = {
  creado: "CREADO",
  actualizado: "ACTUALIZADO",
  omitido: "OMITIDO",
  "ya existía": "YA EXISTÍA",
  aviso: "AVISO",
  error: "ERROR",
  simulado: "SIMULADO",
};

const counts: Record<Status, number> = { creado: 0, actualizado: 0, omitido: 0, "ya existía": 0, aviso: 0, error: 0, simulado: 0 };

function report(status: Status, message: string): void {
  counts[status] += 1;
  const line = `  [${TAG[status]}] ${message}`;
  if (status === "error" || status === "aviso") console.warn(line);
  else console.log(line);
}

const heading = (title: string) => console.log(`\n== ${title} ==`);

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────────────────────── CONTEXTO ───────────────────────────── */

interface Ctx {
  opts: Options;
  content: ContentService;
  collections: CollectionsService;
  shipping: ShippingService;
  /** Etiquetas de caché del storefront tocadas (se avisa de nuevo al terminar, esperando la respuesta). */
  tags: Set<string>;
  /** Páginas que (en simulacro o de verdad) quedan publicadas en esta ejecución. */
  publishedNow: Set<string>;
}

const tagsFor = (kind: ContentKind, key: string) => (kind === "page" ? [`content:${kind}:${key}`, "content:pages"] : [`content:${kind}:${key}`]);

async function getDoc(ctx: Ctx, kind: ContentKind, key: string): Promise<DocumentDetailDto | null> {
  try {
    return await ctx.content.get(kind, key);
  } catch (e) {
    if ((e as { getStatus?: () => number }).getStatus?.() === 404) return null;
    throw e;
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Escribe `data` como borrador del documento y lo publica (versión nueva + auditoría + aviso de revalidación). */
async function saveAndPublish(ctx: Ctx, doc: DocumentDetailDto, data: Json, note: string): Promise<void> {
  await ctx.content.upsertDraft(doc.kind, doc.key, { data, version: doc.version }, undefined, null);
  await ctx.content.publish(doc.kind, doc.key, note, null);
  for (const t of tagsFor(doc.kind, doc.key)) ctx.tags.add(t);
}

/* ───────────────────────────── 1. TRADUCCIONES ───────────────────────────── */

function findMenuItem(items: unknown, id: string): Json | null {
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (!isObj(it)) continue;
    if (it.id === id) return it;
    const inChild = findMenuItem(it.children, id);
    if (inChild) return inChild;
  }
  return null;
}

/** Objeto que contiene el valor al que apunta la regla (raíz, ajustes de sección/bloque o ítem de menú). */
function resolveBase(data: Json, where: TextRule["where"]): Json | null {
  if (!where) return data;
  if (where.item) return findMenuItem(data.items, where.item);
  const section = (Array.isArray(data.sections) ? data.sections : []).find((s): s is Json => isObj(s) && s.id === where.section);
  if (!section) return null;
  if (!where.block) return isObj(section.settings) ? section.settings : null;
  const block = (Array.isArray(section.blocks) ? section.blocks : []).find((b): b is Json => isObj(b) && b.id === where.block);
  return block && isObj(block.settings) ? block.settings : null;
}

type RuleResult = "applied" | "already" | "edited" | "missing";

function applyRule(data: Json, rule: TextRule): RuleResult {
  let node: unknown = resolveBase(data, rule.where);
  if (node === null) return "missing";
  for (const step of rule.path.slice(0, -1)) {
    node = (node as Record<string | number, unknown>)?.[step];
    if (node === undefined || node === null || typeof node !== "object") return "missing";
  }
  const last = rule.path[rule.path.length - 1] as string | number;
  const holder = node as Record<string | number, unknown>;
  const current = holder[last];
  if (current === undefined) return "missing";
  if (current === rule.from) {
    holder[last] = rule.to;
    return "applied";
  }
  return current === rule.to ? "already" : "edited";
}

const ruleLabel = (r: TextRule) => `${r.where?.section ?? r.where?.item ?? "raíz"}${r.where?.block ? `/${r.where.block}` : ""}.${r.path.join(".")}`;

async function stepTranslate(ctx: Ctx): Promise<void> {
  heading("1. Traducción de textos sembrados");

  const byDoc = new Map<string, TextRule[]>();
  for (const rule of TEXT_RULES) byDoc.set(rule.doc, [...(byDoc.get(rule.doc) ?? []), rule]);

  for (const [docId, rules] of byDoc) {
    const [kind, key] = docId.split("/") as [ContentKind, string];
    try {
      const doc = await getDoc(ctx, kind, key);
      if (!doc) {
        report("omitido", `${docId}: el documento no existe (¿no se ejecutó yarn content:seed?)`);
        continue;
      }

      const data = structuredClone(doc.draft) as Json;
      const results = rules.map((rule) => ({ rule, result: applyRule(data, rule) }));
      const applied = results.filter((r) => r.result === "applied");
      const edited = results.filter((r) => r.result === "edited");
      const already = results.filter((r) => r.result === "already").length;

      for (const r of edited) report("omitido", `${docId} · ${ruleLabel(r.rule)}: el admin ya lo editó, no se toca`);

      if (applied.length === 0) {
        report("ya existía", `${docId}: sin textos por traducir${already > 0 ? ` (${already} ya traducidos)` : ""}`);
        continue;
      }
      if (doc.hasUnpublishedChanges) {
        report("aviso", `${docId}: tiene cambios sin publicar en el borrador; no se toca para no publicar a medias el trabajo del admin. Publica o descarta el borrador y vuelve a ejecutar (--only=translate).`);
        continue;
      }

      const detail = applied.map((r) => `"${r.rule.from.replace(/\n/g, "\\n")}" → "${r.rule.to.replace(/\n/g, "\\n")}"`);
      if (ctx.opts.dryRun) {
        report("simulado", `${docId}: se traducirían ${applied.length} texto(s) y se publicaría una versión nueva`);
        for (const d of detail) console.log(`        ${d}`);
        continue;
      }
      await saveAndPublish(ctx, doc, data, TRANSLATION_NOTE);
      report("actualizado", `${docId}: ${applied.length} texto(s) traducidos y publicados (versión nueva)`);
      for (const d of detail) console.log(`        ${d}`);
    } catch (e) {
      report("error", `${docId}: ${errMessage(e)}`);
    }
  }

  // Colecciones del catálogo (entidad): el título "Clothes" se repetía en las tres.
  for (const rule of COLLECTION_RULES) {
    try {
      const col = await ctx.collections.findByHandle(rule.handle);
      if (!col) {
        report("omitido", `colección ${rule.handle}: no existe (¿no se ejecutó yarn catalog:seed?)`);
        continue;
      }
      const patch: { title?: string; seoTitle?: string } = {};
      if (col.title === rule.titleFrom) patch.title = rule.titleTo;
      if (col.seoTitle === rule.seoTitleFrom) patch.seoTitle = rule.seoTitleTo;
      if (Object.keys(patch).length === 0) {
        const edited = col.title !== rule.titleTo || (col.seoTitle !== null && col.seoTitle !== rule.seoTitleTo);
        report(edited ? "omitido" : "ya existía", `colección ${rule.handle}: ${edited ? "título editado por el admin, no se toca" : `ya está en español ("${col.title}")`}`);
        continue;
      }
      const what = Object.entries(patch).map(([k, v]) => `${k}: "${v}"`).join(", ");
      if (ctx.opts.dryRun) {
        report("simulado", `colección ${rule.handle}: se actualizaría ${what}`);
        continue;
      }
      await ctx.collections.update(col.id, patch);
      report("actualizado", `colección ${rule.handle} (handle intacto): ${what}`);
    } catch (e) {
      report("error", `colección ${rule.handle}: ${errMessage(e)}`);
    }
  }
}

/* ───────────────────────────── 3. PÁGINAS LEGALES ───────────────────────────── */

function planZones(): ShippingZoneInfo[] {
  const explicit = new Set(SHIPPING_ZONES.flatMap((z) => (z.departments === "REST" ? [] : z.departments)).map(normalizeDepartment));
  return SHIPPING_ZONES.map((z) => ({
    name: z.name,
    departments: z.departments === "REST" ? DEPARTMENTS.filter((d) => !explicit.has(normalizeDepartment(d))) : z.departments,
    rates: z.rates.map((r) => ({ name: r.name, price: r.price, minDays: r.minDays, maxDays: r.maxDays, freeOverSubtotal: r.freeOverSubtotal })),
  }));
}

const LEGAL_NOTE_DRAFT = "Borrador inicial de la página legal (revisar con un abogado antes de publicar)";
const LEGAL_NOTE_PUBLISH = "Publicación de la página legal (--publish-legal)";

function legalPages(): LegalPage[] {
  return buildLegalPages(BUSINESS, planZones());
}

async function stepLegal(ctx: Ctx): Promise<void> {
  heading("3. Páginas legales");
  const pages = legalPages();

  for (const page of pages) {
    try {
      const markers = findPlaceholders(page.sections);
      const existing = await getDoc(ctx, "page", page.handle);

      if (existing) {
        // Nunca se pisa el contenido. Solo se publica (con --publish-legal) una página que nunca se ha publicado.
        if (existing.published === null && ctx.opts.publishLegal) {
          if (ctx.opts.dryRun) {
            report("simulado", `/pages/${page.handle}: existe en borrador; se publicaría tal cual está (--publish-legal)`);
          } else {
            await ctx.content.publish("page", page.handle, LEGAL_NOTE_PUBLISH, null);
            for (const t of tagsFor("page", page.handle)) ctx.tags.add(t);
            report("actualizado", `/pages/${page.handle}: ya existía en borrador (contenido intacto); ahora está PUBLICADA`);
          }
          ctx.publishedNow.add(page.handle);
        } else {
          report("ya existía", `/pages/${page.handle}: ${existing.published ? "publicada" : "en borrador"}; contenido intacto`);
        }
        continue;
      }

      const remaining = markers.length > 0 ? ` · ${markers.length} marcador(es) [COMPLETAR] por rellenar` : "";
      if (ctx.opts.dryRun) {
        report("simulado", `/pages/${page.handle}: se crearía ${ctx.opts.publishLegal ? "y publicaría" : "como BORRADOR"}${remaining}`);
        if (ctx.opts.publishLegal) ctx.publishedNow.add(page.handle);
        continue;
      }
      await ctx.content.createPage(
        { handle: page.handle, title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, sections: page.sections },
        null,
      );
      if (ctx.opts.publishLegal) {
        await ctx.content.publish("page", page.handle, LEGAL_NOTE_DRAFT, null);
        for (const t of tagsFor("page", page.handle)) ctx.tags.add(t);
        ctx.publishedNow.add(page.handle);
        report("creado", `/pages/${page.handle}: creada y PUBLICADA${remaining}`);
      } else {
        report("creado", `/pages/${page.handle}: creada como BORRADOR (sin publicar)${remaining}`);
      }
    } catch (e) {
      report("error", `/pages/${page.handle}: ${errMessage(e)}`);
    }
  }

  if (!ctx.opts.publishLegal) {
    console.log("  Las páginas legales NO están publicadas. Revísalas (con un abogado) en /admin/content/pages y publícalas ahí,");
    console.log("  o ejecuta de nuevo con --publish-legal. Contienen marcadores [COMPLETAR: ...] con datos del negocio que faltan.");
  } else {
    console.log("  Se publicaron con --publish-legal. Son BORRADORES redactados sin asesoría legal: revísalos con un abogado y rellena los [COMPLETAR: ...].");
  }
}

/* ───────────────────────────── 2. ENLACES DEL PIE ───────────────────────────── */

const CONTACT_PATH = "/pages/contact";

/** ¿Este enlace (url o menú) apunta a /pages/<handle>? */
function linkPointsToPage(link: unknown, handle: string): boolean {
  if (!isObj(link)) return false;
  if (link.type === "page") return link.handle === handle;
  if (link.type === "url" && typeof link.url === "string") return new RegExp(`^/pages/${handle}/?([?#].*)?$`).test(link.url);
  return false;
}
function urlPointsToPage(url: unknown, handle: string): boolean {
  return typeof url === "string" && new RegExp(`^/pages/${handle}/?([?#].*)?$`).test(url);
}

function menuHasPage(items: unknown, handle: string): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((it) => isObj(it) && (linkPointsToPage(it.link, handle) || menuHasPage(it.children, handle)));
}

async function pageIsPublished(ctx: Ctx, handle: string): Promise<boolean> {
  if (ctx.publishedNow.has(handle)) return true;
  const doc = await getDoc(ctx, "page", handle);
  return doc !== null && doc.published !== null;
}

async function stepFooter(ctx: Ctx): Promise<void> {
  heading("2. Enlaces de contacto y legales en el pie de página");
  try {
    const layout = await getDoc(ctx, "template", "layout");
    if (!layout) {
      report("omitido", "template/layout: no existe (¿no se ejecutó yarn content:seed?)");
      return;
    }
    const data = structuredClone(layout.draft) as Json;
    const sections = (Array.isArray(data.sections) ? data.sections : []) as Json[];
    const footer = sections.find((s) => isObj(s) && s.type === "footer");
    if (!footer) {
      report("aviso", "template/layout no tiene sección 'footer': la tienda no pinta enlaces de pie, nada que hacer");
      return;
    }
    const blocks = (Array.isArray(footer.blocks) ? footer.blocks : (footer.blocks = [])) as Json[];

    // Menús que alimentan columnas del pie (por defecto `footer`).
    const menuKeys = new Set<string>(["footer"]);
    for (const b of blocks) if (isObj(b.settings) && typeof b.settings.menuKey === "string") menuKeys.add(b.settings.menuKey);
    const menus: Json[] = [];
    for (const k of menuKeys) {
      const m = await getDoc(ctx, "menu", k);
      if (m) menus.push(m.draft as Json);
    }

    const alreadyLinked = (handle: string) =>
      menus.some((m) => menuHasPage(m.items, handle)) ||
      blocks.some((b) => isObj(b.settings) && Array.isArray(b.settings.links) && (b.settings.links as Json[]).some((l) => urlPointsToPage(l.url, handle)));

    const additions: { id: string; title: string; links: { label: string; url: string }[] }[] = [];

    // Columna "Ayuda": Contacto.
    if (blocks.some((b) => b.id === "col-help")) {
      report("ya existía", "columna 'Ayuda' del pie: ya está (no se toca)");
    } else if (alreadyLinked("contact")) {
      report("ya existía", `el pie ya enlaza ${CONTACT_PATH}: no se añade otro enlace`);
    } else if (!(await pageIsPublished(ctx, "contact"))) {
      report("aviso", `la página 'contact' no existe o no está publicada: no se enlaza ${CONTACT_PATH}`);
    } else {
      additions.push({ id: "col-help", title: "Ayuda", links: [{ label: "Contacto", url: CONTACT_PATH }] });
    }

    // Columna "Legal": solo si TODAS las páginas legales están publicadas (así nunca se enlaza a una 404 ni queda una columna a medias).
    const legal = legalPages();
    if (blocks.some((b) => b.id === "col-legal")) {
      report("ya existía", "columna 'Legal' del pie: ya está (no se toca)");
    } else {
      const unpublished: string[] = [];
      for (const p of legal) if (!(await pageIsPublished(ctx, p.handle))) unpublished.push(p.handle);
      if (unpublished.length > 0) {
        report("omitido", `columna 'Legal': aún no se enlaza porque no están publicadas: ${unpublished.join(", ")}. Publícalas y ejecuta de nuevo (--only=footer).`);
      } else {
        const links = legal.filter((p) => !alreadyLinked(p.handle)).map((p) => ({ label: p.footerLabel, url: `/pages/${p.handle}` }));
        if (links.length === 0) report("ya existía", "el pie ya enlaza todas las páginas legales");
        else additions.push({ id: "col-legal", title: "Legal", links });
      }
    }

    if (additions.length === 0) return;
    if (layout.hasUnpublishedChanges) {
      report("aviso", "template/layout tiene cambios sin publicar en el borrador; no se toca. Publica o descarta el borrador y vuelve a ejecutar (--only=footer).");
      return;
    }
    if (blocks.length + additions.length > 6) {
      report("aviso", `el pie ya tiene ${blocks.length} columnas (máximo 6): no caben ${additions.map((a) => `'${a.title}'`).join(" y ")}. Añade los enlaces a mano en /admin/content/templates/layout.`);
      return;
    }

    for (const add of additions) blocks.push({ id: add.id, type: "column", settings: { title: add.title, links: add.links } });
    const summary = additions.map((a) => `'${a.title}' (${a.links.map((l) => l.label).join(", ")})`).join(" y ");
    if (ctx.opts.dryRun) {
      report("simulado", `template/layout: se añadirían las columnas ${summary}`);
      return;
    }
    await saveAndPublish(ctx, layout, data, "Enlaces de contacto y páginas legales en el pie de página");
    report("actualizado", `template/layout: columnas añadidas y publicadas: ${summary}`);
  } catch (e) {
    report("error", `template/layout: ${errMessage(e)}`);
  }
}

/* ───────────────────────────── 4. ENVÍOS ───────────────────────────── */

async function stepShipping(ctx: Ctx): Promise<void> {
  heading("4. Zonas y tarifas de envío");
  try {
    const existing = await ctx.shipping.listZones();
    const plan = planZones();
    const nameKey = (s: string) => s.trim().toLowerCase();

    for (let i = 0; i < SHIPPING_ZONES.length; i++) {
      const param = SHIPPING_ZONES[i]!;
      const zonePlan = plan[i]!;
      const found = existing.find((z) => nameKey(z.name) === nameKey(param.name));

      if (found) {
        if (found.rates.length > 0) {
          report("ya existía", `zona "${found.name}": ya existe con ${found.rates.length} tarifa(s); no se modifica`);
          continue;
        }
        // Zona existente sin ninguna tarifa (p. ej. una ejecución anterior se interrumpió): se completan sus tarifas.
        report("aviso", `zona "${found.name}": existe sin tarifas; se crean las tarifas que faltan (la zona no se modifica)`);
        await createRates(ctx, found.id, found.name, param);
        continue;
      }

      // Aviso (no bloquea): el backend no valida solapes; si ya hay zonas activas que cubren los mismos departamentos,
      // el checkout ofrecerá las tarifas de ambas.
      const wanted = new Set(zonePlan.departments.map(normalizeDepartment));
      const overlaps = existing
        .filter((z) => z.isActive)
        .map((z) => ({
          zone: z.name,
          all: z.departments.includes("*"),
          shared: z.departments.filter((d) => wanted.has(normalizeDepartment(d))),
        }))
        .filter((o) => o.all || o.shared.length > 0);
      for (const o of overlaps) {
        report(
          "aviso",
          `zona "${param.name}" se solapa con la zona existente "${o.zone}" (${o.all ? "cubre todo el país" : o.shared.join(", ")}): el checkout mostrará las tarifas de ambas zonas. Desactiva o ajusta una en /admin/shipping si no lo quieres.`,
        );
      }

      if (ctx.opts.dryRun) {
        report("simulado", `zona "${param.name}" (${zonePlan.departments.length} departamento(s)): se crearía con ${param.rates.map((r) => `${r.name} $${r.price.toLocaleString("es-CO")}`).join(", ")}`);
        continue;
      }
      const zone = await ctx.shipping.createZone({ name: param.name, departments: zonePlan.departments, isActive: true });
      report("creado", `zona "${zone.name}" (${zone.departments.length} departamento(s))`);
      await createRates(ctx, zone.id, zone.name, param);
    }
  } catch (e) {
    report("error", `envíos: ${errMessage(e)}`);
  }
}

async function createRates(ctx: Ctx, zoneId: string, zoneName: string, param: ZoneParam): Promise<void> {
  for (const [position, r] of param.rates.entries()) {
    try {
      const free = r.freeOverSubtotal !== null ? `, gratis desde $${r.freeOverSubtotal.toLocaleString("es-CO")}` : "";
      const desc = `tarifa "${r.name}" de "${zoneName}": $${r.price.toLocaleString("es-CO")}, ${r.minDays ?? "?"}–${r.maxDays ?? "?"} día(s)${free}`;
      if (ctx.opts.dryRun) {
        report("simulado", `se crearía la ${desc}`);
        continue;
      }
      await ctx.shipping.createRate({
        zoneId,
        name: r.name,
        price: r.price,
        freeOverSubtotal: r.freeOverSubtotal,
        minDays: r.minDays,
        maxDays: r.maxDays,
        isActive: true,
        position,
      });
      report("creado", desc);
    } catch (e) {
      report("error", `tarifa "${r.name}" de "${zoneName}": ${errMessage(e)}`);
    }
  }
}

/* ───────────────────────────── ARRANQUE ───────────────────────────── */

/** Solo lo necesario (sin controladores HTTP, colas de correo ni importadores): el script no debe disparar trabajos de fondo. */
@Module({ imports: [AppConfigModule, ClockModule, AuditModule, ContentModule, CollectionsModule, ShippingModule] })
class CompleteStorefrontModule {}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts === null) {
    console.log(HELP);
    return;
  }

  loadDotEnv();
  const dbName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "") || "(sin nombre)";
    } catch {
      return "(DATABASE_URL no definida o inválida)";
    }
  })();
  console.log(`content:complete · base de datos "${dbName}" · pasos: ${[...opts.only].join(", ")}${opts.dryRun ? " · SIMULACRO (no escribe nada)" : ""}${opts.publishLegal ? " · --publish-legal" : ""}`);

  let app: INestApplicationContext | null = null;
  try {
    app = await NestFactory.createApplicationContext(CompleteStorefrontModule, { logger: ["error", "warn"], abortOnError: false });
    const ctx: Ctx = {
      opts,
      content: app.get(ContentService),
      collections: app.get(CollectionsService),
      shipping: app.get(ShippingService),
      tags: new Set(),
      publishedNow: new Set(),
    };

    // Orden de ejecución: las páginas legales antes que el pie (que solo enlaza lo publicado).
    if (opts.only.has("translate")) await stepTranslate(ctx);
    if (opts.only.has("legal")) await stepLegal(ctx);
    if (opts.only.has("footer")) await stepFooter(ctx);
    if (opts.only.has("shipping")) await stepShipping(ctx);

    // La publicación avisa al storefront sin esperar (fire-and-forget); aquí se espera para no cerrar antes de que llegue.
    if (!opts.dryRun && ctx.tags.size > 0) await app.get(RevalidationService).notifyMany(ctx.tags);

    heading("Resumen");
    console.log(
      `  creado: ${counts.creado} · actualizado: ${counts.actualizado} · ya existía: ${counts["ya existía"]} · omitido: ${counts.omitido} · avisos: ${counts.aviso}` +
        (opts.dryRun ? ` · simulado: ${counts.simulado}` : "") +
        ` · errores: ${counts.error}`,
    );
    if (opts.dryRun) console.log("  Simulacro: no se escribió nada. Ejecuta de nuevo sin --dry-run para aplicar.");
    if (counts.error > 0) process.exitCode = 1;
  } catch (e) {
    console.error("Error en content:complete:", e);
    process.exitCode = 1;
  } finally {
    // close() vacía la caché del catálogo pendiente (revalidación de colecciones) antes de salir.
    if (app) await app.close();
  }
}

void main();
