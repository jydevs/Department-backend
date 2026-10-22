import type { DataSource } from "typeorm";
import { AuditLog } from "../../identity/entities";
import { sameDocument } from "../content/content.util";
import { ContentDocument, ContentVersion } from "../entities";
import { parseDocument } from "../schemas";
import type { SeedLogger } from "./default-content";
import { LEGAL_FOOTER_COLUMN } from "./legal-content";

export type EnsureLegalLinksOutcome = "published" | "skipped";

const SEED_NOTE = "Contenido inicial";
const LEGAL_NOTE = "Enlaces legales en el pie de página";

interface SectionLike {
  type?: unknown;
  blocks?: unknown;
}
interface BlockLike {
  id?: unknown;
  type?: unknown;
  settings?: { title?: unknown };
}

function footerOf(data: Record<string, unknown>): (SectionLike & { blocks?: BlockLike[] }) | null {
  const sections = Array.isArray(data.sections) ? (data.sections as SectionLike[]) : [];
  const footer = sections.find((s) => s.type === "footer");
  return footer ? (footer as SectionLike & { blocks?: BlockLike[] }) : null;
}

/**
 * Bases ya sembradas: añade la columna "Legal" al pie de `template/layout` SOLO si el contenido sigue siendo el sembrado
 * (versión publicada única #1 "Contenido inicial", sin borrador ni ediciones posteriores) y aún no tiene esa columna.
 * Si el administrador ya tocó el layout, no se modifica. Idempotente. Publica una versión nueva con auditoría `system`.
 */
export async function ensureLegalLinks(dataSource: DataSource, opts: { logger?: SeedLogger } = {}): Promise<EnsureLegalLinksOutcome> {
  return dataSource.transaction(async (manager) => {
    const rows: { id: string }[] = await manager.query(`SELECT id FROM content_documents WHERE kind = 'template' AND key = 'layout' AND deleted_at IS NULL FOR UPDATE`);
    const id = rows[0]?.id;
    if (!id) return "skipped";

    const doc = await manager.findOneByOrFail(ContentDocument, { id });
    if (!doc.publishedVersionId || doc.draftUpdatedBy) return "skipped";

    const versions = await manager.find(ContentVersion, { where: { documentId: id } });
    const only = versions[0];
    if (versions.length !== 1 || !only || only.id !== doc.publishedVersionId) return "skipped";
    if (only.number !== 1 || only.note !== SEED_NOTE || only.authorId || only.status !== "published") return "skipped";
    // un borrador distinto de lo publicado significa que alguien editó el layout
    if (!sameDocument(doc.draft, only.data)) return "skipped";

    const next = structuredClone(only.data) as Record<string, unknown>;
    const footer = footerOf(next);
    if (!footer) return "skipped";
    const blocks: BlockLike[] = Array.isArray(footer.blocks) ? footer.blocks : [];
    if (blocks.some((b) => b.settings?.title === "Legal" || b.id === LEGAL_FOOTER_COLUMN.id)) return "skipped";
    footer.blocks = [...blocks, structuredClone(LEGAL_FOOTER_COLUMN)];

    const parsed = parseDocument("template", "layout", next);
    if (!parsed.ok) {
      opts.logger?.warn(`Legal links not added to template/layout: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
      return "skipped";
    }

    const now = new Date();
    const version = manager.create(ContentVersion, {
      documentId: id,
      number: 2,
      title: doc.title ?? null,
      data: parsed.data,
      status: "published",
      publishAt: null,
      publishedAt: now,
      authorId: null,
      note: LEGAL_NOTE,
    });
    await manager.save(version);
    await manager.query(`UPDATE content_versions SET status = 'superseded', superseded_at = $3 WHERE document_id = $1 AND status = 'published' AND id <> $2`, [id, version.id, now]);
    await manager.query(
      `UPDATE content_documents SET published_version_id = $2, draft = $3::jsonb, draft_updated_at = $4, updated_at = $4, version = version + 1 WHERE id = $1`,
      [id, version.id, JSON.stringify(parsed.data), now],
    );
    await manager.save(
      manager.create(AuditLog, {
        actorType: "system",
        actorId: null,
        action: "content:publish",
        entityType: "ContentDocument",
        entityId: id,
        diff: { kind: "template", key: "layout", versionNumber: 2, changedKeys: ["sections"] },
      }),
    );
    opts.logger?.log("Legal links added to template/layout (version 2)");
    return "published";
  });
}
