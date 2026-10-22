import type { DataSource, EntityManager } from "typeorm";
import { AuditLog } from "../../identity/entities";
import { changedKeys, sameDocument } from "../content/content.util";
import { ContentDocument, ContentVersion } from "../entities";
import type { ContentKind } from "../entities/content-document.entity";
import { parseDocument } from "../schemas";
import { BRAND_EXTRA, CART_EXTRA_LABELS, LOAD_MORE_LABELS, PRODUCT_CARD_LABELS, THEME_EXTRA, type SeedLogger } from "./default-content";

/** Nota de la versión que publica este paso; también sirve de marca para no repetirlo en ese documento. */
export const EDITABLE_DEFAULTS_NOTE = "Campos editables nuevos (valores por defecto)";

type Obj = Record<string, unknown>;

/** Qué añadir a cada documento: grupos de settings (`groups`) o ajustes de las secciones de un tipo (`sections`). */
interface EditablePatch {
  kind: ContentKind;
  key: string;
  groups?: Record<string, Obj>;
  sections?: Record<string, Obj>;
}

export const EDITABLE_PATCHES: EditablePatch[] = [
  { kind: "settings", key: "site", groups: { brand: BRAND_EXTRA, theme: THEME_EXTRA } },
  { kind: "template", key: "home", sections: { campaign: PRODUCT_CARD_LABELS } },
  { kind: "template", key: "collection", sections: { "product-grid": { ...PRODUCT_CARD_LABELS, ...LOAD_MORE_LABELS } } },
  { kind: "template", key: "product", sections: { "product-grid": PRODUCT_CARD_LABELS } },
  { kind: "template", key: "cart", sections: { "cart-drawer": CART_EXTRA_LABELS } },
];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Añade a `target` las claves de `defaults` que no tiene (nunca sobrescribe). Devuelve true si cambió algo. */
function fillMissing(target: Obj, defaults: Obj): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) {
    if (target[k] === undefined) {
      target[k] = structuredClone(v);
      changed = true;
    }
  }
  return changed;
}

/** Copia de `data` con los campos que faltan, o null si no falta ninguno. */
export function applyEditablePatch(patch: EditablePatch, data: unknown): Obj | null {
  if (!isObj(data)) return null;
  const next = structuredClone(data);
  let changed = false;
  for (const [group, defaults] of Object.entries(patch.groups ?? {})) {
    if (!isObj(next[group])) continue;
    changed = fillMissing(next[group] as Obj, defaults) || changed;
  }
  for (const [type, defaults] of Object.entries(patch.sections ?? {})) {
    const sections = Array.isArray(next.sections) ? (next.sections as unknown[]) : [];
    for (const section of sections) {
      if (!isObj(section) || section.type !== type || !isObj(section.settings)) continue;
      changed = fillMissing(section.settings, defaults) || changed;
    }
  }
  return changed ? next : null;
}

async function ensureOne(manager: EntityManager, patch: EditablePatch, logger?: SeedLogger): Promise<boolean> {
  const label = `${patch.kind}/${patch.key}`;
  const rows: { id: string }[] = await manager.query(
    `SELECT id FROM content_documents WHERE kind = $1 AND key = $2 AND deleted_at IS NULL FOR UPDATE`,
    [patch.kind, patch.key],
  );
  const id = rows[0]?.id;
  if (!id) return false;
  // ya aplicado una vez: si luego el administrador vació un campo, se respeta
  const marked: unknown[] = await manager.query(`SELECT 1 FROM content_versions WHERE document_id = $1 AND note = $2 LIMIT 1`, [id, EDITABLE_DEFAULTS_NOTE]);
  if (marked.length > 0) return false;

  const doc = await manager.findOneByOrFail(ContentDocument, { id });
  const published = doc.publishedVersionId ? await manager.findOneBy(ContentVersion, { id: doc.publishedVersionId }) : null;
  const draftWasPublished = published ? sameDocument(doc.draft, published.data) : false;

  const nextPublished = published ? applyEditablePatch(patch, published.data) : null;
  const nextDraft = applyEditablePatch(patch, doc.draft);
  if (!nextPublished && !nextDraft) return false;

  const validate = (data: Obj): Obj | null => {
    const parsed = parseDocument(patch.kind, patch.key, data);
    if (parsed.ok) return parsed.data;
    logger?.warn(`Editable defaults not added to ${label}: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    return null;
  };

  const now = new Date();
  let publishedData: Obj | null = null;
  if (published && nextPublished) {
    publishedData = validate(nextPublished);
    if (!publishedData) return false;
  }
  // un borrador idéntico a lo publicado sigue idéntico; uno con cambios pendientes los conserva y recibe los campos
  const draftData = draftWasPublished && publishedData ? publishedData : nextDraft ? validate(nextDraft) : null;

  if (published && publishedData) {
    const [{ max }] = (await manager.query(`SELECT COALESCE(MAX(number), 0) AS max FROM content_versions WHERE document_id = $1`, [id])) as { max: number }[];
    const version = manager.create(ContentVersion, {
      documentId: id,
      number: Number(max) + 1,
      title: published.title ?? null,
      data: publishedData,
      status: "published",
      publishAt: null,
      publishedAt: now,
      authorId: null,
      note: EDITABLE_DEFAULTS_NOTE,
    });
    await manager.save(version);
    await manager.query(`UPDATE content_versions SET status = 'superseded', superseded_at = $3 WHERE document_id = $1 AND status = 'published' AND id <> $2`, [id, version.id, now]);
    await manager.query(`UPDATE content_documents SET published_version_id = $2, updated_at = $3, version = version + 1 WHERE id = $1`, [id, version.id, now]);
    await manager.save(
      manager.create(AuditLog, {
        actorType: "system",
        actorId: null,
        action: "content:publish",
        entityType: "ContentDocument",
        entityId: id,
        diff: { kind: patch.kind, key: patch.key, versionNumber: version.number, changedKeys: changedKeys(published.data as Obj, publishedData) },
      }),
    );
  }
  if (draftData) {
    // draft_updated_by se conserva: el borrador sigue siendo del mismo autor
    await manager.query(`UPDATE content_documents SET draft = $2::jsonb, draft_updated_at = $3, updated_at = $3, version = version + 1 WHERE id = $1`, [id, JSON.stringify(draftData), now]);
  }
  logger?.log(`Editable defaults added to ${label}`);
  return true;
}

/**
 * Bases ya sembradas: añade los campos editables nuevos (logotipo de texto, favicon, grano, textos de tarjetas, del carrito…)
 * con el valor que la tienda mostraba fijo, SOLO donde faltan. Nunca sobrescribe un valor existente ni toca otros campos.
 * Si el documento estaba publicado, publica una versión nueva (auditoría `system`); un borrador con cambios pendientes los
 * conserva. Se aplica una sola vez por documento (marca: la nota de la versión). Idempotente.
 */
export async function ensureEditableDefaults(dataSource: DataSource, opts: { logger?: SeedLogger } = {}): Promise<string[]> {
  const updated: string[] = [];
  for (const patch of EDITABLE_PATCHES) {
    try {
      const changed = await dataSource.transaction((manager) => ensureOne(manager, patch, opts.logger));
      if (changed) updated.push(`${patch.kind}/${patch.key}`);
    } catch (err) {
      opts.logger?.warn(`Editable defaults not added to ${patch.kind}/${patch.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return updated;
}
