import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { ContentDocument, ContentVersion } from "../entities";
import type { ContentKind } from "../entities/content-document.entity";
import { parseDocument } from "../schemas";
import { listSectionTypes, SectionTypeDescriptor } from "../sections/registry";
import type {
  CreatePageDto,
  DocumentDetailDto,
  DocumentListItemDto,
  PageDeletedDto,
  PreviewTokenResponseDto,
  UpsertDraftDto,
  VersionDetailDto,
  VersionSummaryDto,
} from "./content.dto";
import { changedKeys, isUniqueViolation, sameDocument } from "./content.util";
import { PreviewService } from "./preview.service";
import { RevalidationService } from "./revalidation.service";

const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const SCHEDULER_BATCH = 50;

interface ListRow {
  id: string;
  kind: ContentKind;
  key: string;
  title: string | null;
  version: number;
  draft_updated_at: Date;
  published_at: Date | null;
  has_unpublished_changes: boolean;
  scheduled_at: Date | null;
}

interface IdRow {
  id: string;
}

function validationError(issues: { path: string; message: string }[]): AppException {
  return AppException.badRequest("VALIDATION_ERROR", "El contenido no es válido", issues);
}

function tagsFor(kind: ContentKind, key: string): string[] {
  return kind === "page" ? [`content:${kind}:${key}`, "content:pages"] : [`content:${kind}:${key}`];
}

/** TypeORM's postgres `query()` returns `[rows, count]` for UPDATE/DELETE and `rows` for SELECT. */
function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") return result[0];
  return Array.isArray(result) ? result : [];
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(ContentDocument) private readonly documents: Repository<ContentDocument>,
    @InjectRepository(ContentVersion) private readonly versions: Repository<ContentVersion>,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly preview: PreviewService,
    private readonly revalidation: RevalidationService,
  ) {}

  /* ── reads ─────────────────────────────────────────────── */

  sectionTypes(): SectionTypeDescriptor[] {
    return listSectionTypes();
  }

  async list(kind: ContentKind | undefined): Promise<DocumentListItemDto[]> {
    const rows: ListRow[] = await this.documents.query(
      `SELECT d.id, d.kind, d.key, d.title, d.version, d.draft_updated_at,
              pv.published_at,
              (pv.id IS NULL OR d.draft IS DISTINCT FROM pv.data) AS has_unpublished_changes,
              (SELECT MIN(s.publish_at) FROM content_versions s WHERE s.document_id = d.id AND s.status = 'scheduled') AS scheduled_at
         FROM content_documents d
         LEFT JOIN content_versions pv ON pv.id = d.published_version_id
        WHERE d.deleted_at IS NULL AND ($1::text IS NULL OR d.kind = $1)
        ORDER BY d.kind, d.key`,
      [kind ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      key: r.key,
      title: r.title,
      version: r.version,
      hasUnpublishedChanges: r.has_unpublished_changes,
      publishedAt: r.published_at,
      scheduledAt: r.scheduled_at,
      draftUpdatedAt: r.draft_updated_at,
    }));
  }

  async get(kind: ContentKind, key: string): Promise<DocumentDetailDto> {
    return this.buildDetail(await this.requireDocument(this.documents.manager, kind, key));
  }

  async listVersions(kind: ContentKind, key: string, page: number, pageSize: number): Promise<OffsetPage<VersionSummaryDto>> {
    const doc = await this.requireDocument(this.documents.manager, kind, key);
    const [rows, total] = await this.versions.findAndCount({
      where: { documentId: doc.id },
      order: { number: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return toOffsetPage(
      rows.map((v) => this.toVersionSummary(v)),
      total,
      page,
      pageSize,
    );
  }

  async getVersion(kind: ContentKind, key: string, versionId: string): Promise<VersionDetailDto> {
    const doc = await this.requireDocument(this.documents.manager, kind, key);
    const v = await this.versions.findOne({ where: { id: versionId, documentId: doc.id } });
    if (!v) throw AppException.notFound("Version");
    return { ...this.toVersionSummary(v), data: v.data };
  }

  async createPreviewToken(kind: ContentKind, key: string): Promise<PreviewTokenResponseDto> {
    await this.requireDocument(this.documents.manager, kind, key);
    return this.preview.sign(kind, key);
  }

  /* ── draft writes ──────────────────────────────────────── */

  async upsertDraft(kind: ContentKind, key: string, input: UpsertDraftDto, ifMatch: number | undefined, actorId: string | null): Promise<DocumentDetailDto> {
    const parsed = parseDocument(kind, key, input.data);
    if (!parsed.ok) throw validationError(parsed.issues);
    const expected = input.version ?? ifMatch;
    const now = this.clock.now();
    const title = kind === "page" ? String(parsed.data.title ?? "") : (input.title ?? null);

    await this.tx.run(async (manager) => {
      const existing = await manager.findOne(ContentDocument, { where: { kind, key } });
      if (!existing) {
        if (kind === "page") throw AppException.notFound("Page (create it with POST /admin/content/pages)");
        const doc = manager.create(ContentDocument, { kind, key, title, draft: parsed.data, draftUpdatedAt: now, draftUpdatedBy: actorId, publishedVersionId: null });
        try {
          await manager.save(doc);
        } catch (err) {
          if (isUniqueViolation(err)) throw AppException.conflict("CONCURRENT_UPDATE", "The document was created concurrently, reload and retry");
          throw err;
        }
        await this.audit.record({ action: "content:create", entityType: "ContentDocument", entityId: doc.id, diff: { kind, key } }, manager);
        return;
      }
      if (expected === undefined) throw AppException.badRequest("VERSION_REQUIRED", "Send the document version (body.version or If-Match header)");
      const updated: unknown = await manager.query(
        `UPDATE content_documents
            SET draft = $1::jsonb, title = $2, draft_updated_at = $3, draft_updated_by = $4, updated_at = $3, version = version + 1
          WHERE id = $5 AND version = $6 AND deleted_at IS NULL
        RETURNING version`,
        [JSON.stringify(parsed.data), title, now, actorId, existing.id, expected],
      );
      if (rowsOf(updated).length === 0) {
        throw AppException.conflict("CONCURRENT_UPDATE", "The document was modified by someone else, reload and retry");
      }
      await this.audit.record(
        {
          action: "content:update",
          entityType: "ContentDocument",
          entityId: existing.id,
          diff: {
            kind,
            key,
            changedKeys: changedKeys(existing.draft, parsed.data),
            titleChanged: (existing.title ?? null) !== title,
            version: { old: existing.version, new: existing.version + 1 },
          },
        },
        manager,
      );
    });
    return this.get(kind, key);
  }

  async createPage(input: CreatePageDto, actorId: string | null): Promise<DocumentDetailDto> {
    const data: Record<string, unknown> = {
      title: input.title,
      handle: input.handle,
      template: "page",
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      sections: input.sections,
    };
    const parsed = parseDocument("page", input.handle, data);
    if (!parsed.ok) throw validationError(parsed.issues);
    const now = this.clock.now();

    await this.tx.run(async (manager) => {
      const doc = manager.create(ContentDocument, {
        kind: "page",
        key: input.handle,
        title: input.title,
        draft: parsed.data,
        draftUpdatedAt: now,
        draftUpdatedBy: actorId,
        publishedVersionId: null,
      });
      try {
        await manager.save(doc);
      } catch (err) {
        if (isUniqueViolation(err)) throw AppException.conflict("CONFLICT", `A page with handle "${input.handle}" already exists`);
        throw err;
      }
      await this.audit.record({ action: "content:create", entityType: "ContentDocument", entityId: doc.id, diff: { kind: "page", key: input.handle, title: input.title } }, manager);
    });
    return this.get("page", input.handle);
  }

  async deletePage(kind: ContentKind, key: string): Promise<PageDeletedDto> {
    if (kind !== "page") throw AppException.badRequest("BAD_REQUEST", "Only pages can be deleted");
    const now = this.clock.now();
    await this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      await manager.query(`UPDATE content_versions SET status = 'cancelled' WHERE document_id = $1 AND status = 'scheduled'`, [id]);
      await manager.query(`UPDATE content_documents SET deleted_at = $2, updated_at = $2, version = version + 1 WHERE id = $1`, [id, now]);
      await this.audit.record({ action: "content:delete", entityType: "ContentDocument", entityId: id, diff: { kind, key } }, manager);
    });
    void this.revalidation.notify(tagsFor(kind, key));
    return { deleted: true, suggestedRedirect: { fromPath: `/pages/${key}`, toPath: "/" } };
  }

  async discard(kind: ContentKind, key: string, actorId: string | null): Promise<DocumentDetailDto> {
    const now = this.clock.now();
    await this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      const doc = await manager.findOneByOrFail(ContentDocument, { id });
      const published = await this.publishedVersion(manager, doc);
      if (!published) throw AppException.conflict("NOT_PUBLISHED", "The document has no published version to go back to");
      await this.setDraft(manager, id, published.data, now, actorId);
      await this.audit.record(
        { action: "content:discard", entityType: "ContentDocument", entityId: id, diff: { kind, key, changedKeys: changedKeys(doc.draft, published.data) } },
        manager,
      );
    });
    return this.get(kind, key);
  }

  async restore(kind: ContentKind, key: string, versionId: string, actorId: string | null): Promise<DocumentDetailDto> {
    const now = this.clock.now();
    await this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      const doc = await manager.findOneByOrFail(ContentDocument, { id });
      const v = await manager.findOne(ContentVersion, { where: { id: versionId, documentId: id } });
      if (!v) throw AppException.notFound("Version");
      await this.setDraft(manager, id, v.data, now, actorId);
      await this.audit.record(
        {
          action: "content:restore",
          entityType: "ContentDocument",
          entityId: id,
          diff: { kind, key, versionId, versionNumber: v.number, changedKeys: changedKeys(doc.draft, v.data) },
        },
        manager,
      );
    });
    return this.get(kind, key);
  }

  /* ── publish / schedule ────────────────────────────────── */

  async publish(kind: ContentKind, key: string, note: string | undefined, actorId: string | null): Promise<DocumentDetailDto> {
    const now = this.clock.now();
    await this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      const doc = await manager.findOneByOrFail(ContentDocument, { id });
      const parsed = parseDocument(kind, key, doc.draft);
      if (!parsed.ok) throw validationError(parsed.issues);
      const current = await this.publishedVersion(manager, doc);
      if (current && sameDocument(current.data, parsed.data)) {
        throw AppException.conflict("NOTHING_TO_PUBLISH", "The draft is identical to the published version");
      }
      const number = await this.nextNumber(manager, id);
      const version = manager.create(ContentVersion, {
        documentId: id,
        number,
        data: parsed.data,
        status: "published",
        publishAt: null,
        publishedAt: now,
        authorId: actorId,
        note: note ?? null,
      });
      await manager.save(version);
      await this.activate(manager, id, version.id, now, true);
      await this.audit.record(
        {
          action: "content:publish",
          entityType: "ContentDocument",
          entityId: id,
          diff: { kind, key, versionNumber: number, changedKeys: changedKeys(current?.data ?? null, parsed.data) },
        },
        manager,
      );
    });
    void this.revalidation.notify(tagsFor(kind, key));
    return this.get(kind, key);
  }

  async schedule(kind: ContentKind, key: string, publishAtIso: string, note: string | undefined, actorId: string | null): Promise<VersionSummaryDto> {
    const now = this.clock.now();
    const publishAt = new Date(publishAtIso);
    if (publishAt.getTime() <= now.getTime()) {
      throw AppException.badRequest("VALIDATION_ERROR", "publishAt must be in the future", [{ path: "publishAt", message: "Debe ser una fecha futura" }]);
    }
    if (publishAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
      throw AppException.badRequest("VALIDATION_ERROR", "publishAt is too far ahead", [{ path: "publishAt", message: "Máximo 1 año hacia adelante" }]);
    }
    return this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      const doc = await manager.findOneByOrFail(ContentDocument, { id });
      const parsed = parseDocument(kind, key, doc.draft);
      if (!parsed.ok) throw validationError(parsed.issues);
      const number = await this.nextNumber(manager, id);
      const version = manager.create(ContentVersion, {
        documentId: id,
        number,
        data: parsed.data, // snapshot of the draft AT THIS MOMENT
        status: "scheduled",
        publishAt,
        publishedAt: null,
        authorId: actorId,
        note: note ?? null,
      });
      await manager.save(version);
      await this.audit.record(
        { action: "content:schedule", entityType: "ContentDocument", entityId: id, diff: { kind, key, versionNumber: number, publishAt: publishAt.toISOString() } },
        manager,
      );
      const saved = await manager.findOneByOrFail(ContentVersion, { id: version.id });
      return this.toVersionSummary(saved);
    });
  }

  async cancelSchedule(kind: ContentKind, key: string, versionId: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const id = await this.lockDocument(manager, kind, key);
      const res: unknown = await manager.query(
        `UPDATE content_versions SET status = 'cancelled' WHERE id = $1 AND document_id = $2 AND status = 'scheduled' RETURNING number`,
        [versionId, id],
      );
      if (rowsOf(res).length === 0) throw AppException.notFound("Scheduled version");
      await this.audit.record({ action: "content:schedule-cancel", entityType: "ContentDocument", entityId: id, diff: { kind, key, versionId } }, manager);
    });
  }

  /* ── scheduler entry point ─────────────────────────────── */

  /** Promotes every due scheduled version. One failing version never blocks the others. Returns how many were published. */
  async promoteDue(): Promise<number> {
    const now = this.clock.now();
    const due: { id: string; document_id: string }[] = await this.versions.query(
      `SELECT id, document_id FROM content_versions WHERE status = 'scheduled' AND publish_at <= $1 ORDER BY publish_at, number LIMIT ${SCHEDULER_BATCH}`,
      [now],
    );
    let promoted = 0;
    for (const candidate of due) {
      try {
        const tags = await this.promoteScheduled(candidate.id, candidate.document_id, now);
        if (tags) {
          promoted++;
          void this.revalidation.notify(tags);
        }
      } catch (err) {
        this.logger.error(`Scheduled publish failed for version ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return promoted;
  }

  private async promoteScheduled(versionId: string, documentId: string, now: Date): Promise<string[] | null> {
    return this.tx.run(async (manager) => {
      // Same lock order as every other writer (document first, then version) to avoid deadlocks.
      const docRows: { id: string; kind: ContentKind; key: string; deleted_at: Date | null }[] = await manager.query(
        `SELECT id, kind, key, deleted_at FROM content_documents WHERE id = $1 FOR UPDATE`,
        [documentId],
      );
      const doc = docRows[0];
      const locked: IdRow[] = await manager.query(
        `SELECT id FROM content_versions WHERE id = $1 AND status = 'scheduled' AND publish_at <= $2 FOR UPDATE SKIP LOCKED`,
        [versionId, now],
      );
      if (locked.length === 0) return null; // already promoted / cancelled / locked by another instance
      if (!doc || doc.deleted_at) {
        await manager.query(`UPDATE content_versions SET status = 'cancelled' WHERE id = $1`, [versionId]);
        return null;
      }
      const version = await manager.findOneByOrFail(ContentVersion, { id: versionId });
      const parsed = parseDocument(doc.kind, doc.key, version.data);
      if (!parsed.ok) {
        await manager.query(`UPDATE content_versions SET status = 'cancelled', note = 'Cancelada: contenido inválido al publicar' WHERE id = $1`, [versionId]);
        await this.audit.record(
          { action: "content:schedule-invalid", entityType: "ContentDocument", entityId: doc.id, diff: { kind: doc.kind, key: doc.key, versionNumber: version.number } },
          manager,
        );
        return null;
      }
      await this.activate(manager, doc.id, versionId, now, false);
      await this.audit.record(
        { action: "content:publish", entityType: "ContentDocument", entityId: doc.id, diff: { kind: doc.kind, key: doc.key, versionNumber: version.number, scheduled: true } },
        manager,
      );
      return tagsFor(doc.kind, doc.key);
    });
  }

  /* ── internals ─────────────────────────────────────────── */

  private async requireDocument(manager: EntityManager, kind: ContentKind, key: string): Promise<ContentDocument> {
    const doc = await manager.findOne(ContentDocument, { where: { kind, key } });
    if (!doc) throw AppException.notFound("Document");
    return doc;
  }

  /** `SELECT ... FOR UPDATE` on the document row: serializes publish/schedule/version numbering per document. */
  private async lockDocument(manager: EntityManager, kind: ContentKind, key: string): Promise<string> {
    const rows: IdRow[] = await manager.query(`SELECT id FROM content_documents WHERE kind = $1 AND key = $2 AND deleted_at IS NULL FOR UPDATE`, [kind, key]);
    const row = rows[0];
    if (!row) throw AppException.notFound("Document");
    return row.id;
  }

  private async nextNumber(manager: EntityManager, documentId: string): Promise<number> {
    const rows: { next: number }[] = await manager.query(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM content_versions WHERE document_id = $1`, [documentId]);
    return Number(rows[0]?.next ?? 1);
  }

  private async publishedVersion(manager: EntityManager, doc: ContentDocument): Promise<ContentVersion | null> {
    if (!doc.publishedVersionId) return null;
    return manager.findOne(ContentVersion, { where: { id: doc.publishedVersionId } });
  }

  /** Makes `versionId` the live version: supersedes the previous one and moves the document pointer. */
  private async activate(manager: EntityManager, documentId: string, versionId: string, now: Date, alreadyPublished: boolean): Promise<void> {
    await manager.query(`UPDATE content_versions SET status = 'superseded', superseded_at = $3 WHERE document_id = $1 AND status = 'published' AND id <> $2`, [documentId, versionId, now]);
    if (!alreadyPublished) {
      await manager.query(`UPDATE content_versions SET status = 'published', published_at = $2 WHERE id = $1`, [versionId, now]);
    }
    await manager.query(`UPDATE content_documents SET published_version_id = $2, updated_at = $3 WHERE id = $1`, [documentId, versionId, now]);
  }

  private async setDraft(manager: EntityManager, id: string, data: Record<string, unknown>, now: Date, actorId: string | null): Promise<void> {
    await manager.query(
      `UPDATE content_documents SET draft = $2::jsonb, draft_updated_at = $3, draft_updated_by = $4, updated_at = $3, version = version + 1 WHERE id = $1`,
      [id, JSON.stringify(data), now, actorId],
    );
  }

  private async buildDetail(doc: ContentDocument): Promise<DocumentDetailDto> {
    const published = doc.publishedVersionId ? await this.versions.findOne({ where: { id: doc.publishedVersionId } }) : null;
    const scheduled = await this.versions.find({ where: { documentId: doc.id, status: "scheduled" }, order: { publishAt: "ASC" } });
    return {
      id: doc.id,
      kind: doc.kind,
      key: doc.key,
      title: doc.title ?? null,
      version: doc.version,
      draft: doc.draft,
      draftUpdatedAt: doc.draftUpdatedAt,
      hasUnpublishedChanges: !published || !sameDocument(published.data, doc.draft),
      published: published ? { versionId: published.id, number: published.number, publishedAt: published.publishedAt ?? null } : null,
      scheduled: scheduled.map((s) => ({ versionId: s.id, number: s.number, publishAt: s.publishAt ?? null })),
    };
  }

  private toVersionSummary(v: ContentVersion): VersionSummaryDto {
    return {
      id: v.id,
      number: v.number,
      status: v.status,
      publishAt: v.publishAt ?? null,
      publishedAt: v.publishedAt ?? null,
      supersededAt: v.supersededAt ?? null,
      authorId: v.authorId ?? null,
      note: v.note ?? null,
      createdAt: v.createdAt,
    };
  }
}
