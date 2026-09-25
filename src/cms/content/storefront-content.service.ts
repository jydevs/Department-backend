import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { ContentDocument } from "../entities";
import type { ContentKind } from "../entities/content-document.entity";
import type { StorefrontBundleDto, StorefrontDocumentDto, StorefrontPageListItemDto } from "./content.dto";
import { weakEtag } from "./content.util";
import { PreviewService } from "./preview.service";

interface PublishedRow {
  kind: ContentKind;
  key: string;
  title: string | null;
  data: Record<string, unknown>;
  published_at: Date | null;
  version_id: string;
  number: number;
}

export interface Served<T> {
  body: T;
  /** Weak ETag for published reads; null for previews (never cacheable). */
  etag: string | null;
  preview: boolean;
}

@Injectable()
export class StorefrontContentService {
  constructor(
    @InjectRepository(ContentDocument) private readonly documents: Repository<ContentDocument>,
    private readonly preview: PreviewService,
  ) {}

  async get(kind: ContentKind, key: string, previewToken: string | undefined): Promise<Served<StorefrontDocumentDto>> {
    if (previewToken !== undefined) {
      if (!(await this.preview.verify(previewToken, kind, key))) throw AppException.unauthorized("Invalid or expired preview token");
      const doc = await this.documents.findOne({ where: { kind, key } });
      if (!doc) throw AppException.notFound("Document");
      return { body: { kind, key, title: doc.title ?? null, data: doc.draft, publishedAt: null }, etag: null, preview: true };    }
    const rows = await this.publishedRows([{ kind, key }]);
    const row = rows[0];
    if (!row) throw AppException.notFound("Document");
    return { body: this.toDto(row), etag: weakEtag(row.version_id, String(row.number)), preview: false };
  }

  async listPages(): Promise<Served<StorefrontPageListItemDto[]>> {
    const rows: { key: string; title: string | null; version_id: string; number: number }[] = await this.documents.query(
      `SELECT d.key, pv.data->>'title' AS title, pv.id AS version_id, pv.number
         FROM content_documents d JOIN content_versions pv ON pv.id = d.published_version_id
        WHERE d.kind = 'page' AND d.deleted_at IS NULL ORDER BY d.key`,
    );
    return {
      body: rows.map((r) => ({ handle: r.key, title: r.title })),
      etag: weakEtag("pages", ...rows.map((r) => `${r.version_id}:${r.number}`)),
      preview: false,
    };
  }

  /** Settings + main/footer menus + one template in a single call (published only; missing pieces are null). */
  async bundle(template: string): Promise<Served<StorefrontBundleDto>> {
    const rows = await this.publishedRows([
      { kind: "settings", key: "site" },
      { kind: "menu", key: "main" },
      { kind: "menu", key: "footer" },
      { kind: "template", key: template },
    ]);
    const find = (kind: ContentKind, key: string): StorefrontDocumentDto | null => {
      const r = rows.find((x) => x.kind === kind && x.key === key);
      return r ? this.toDto(r) : null;
    };
    return {
      body: {
        settings: find("settings", "site"),
        menus: { main: find("menu", "main"), footer: find("menu", "footer") },
        template: find("template", template),
      },
      etag: weakEtag("bundle", template, ...rows.map((r) => `${r.kind}:${r.key}:${r.version_id}:${r.number}`).sort()),
      preview: false,
    };
  }

  private async publishedRows(targets: { kind: ContentKind; key: string }[]): Promise<PublishedRow[]> {
    const params: unknown[] = [];
    const conds = targets.map((t) => {
      params.push(t.kind, t.key);
      return `(d.kind = $${params.length - 1} AND d.key = $${params.length})`;
    });
    return this.documents.query(
      `SELECT d.kind, d.key, CASE WHEN d.kind = 'page' THEN pv.data->>'title' ELSE pv.title END AS title, pv.data, pv.published_at, pv.id AS version_id, pv.number
         FROM content_documents d JOIN content_versions pv ON pv.id = d.published_version_id
        WHERE d.deleted_at IS NULL AND (${conds.join(" OR ")})`,
      params,
    );
  }

  private toDto(r: PublishedRow): StorefrontDocumentDto {
    return { kind: r.kind, key: r.key, title: r.title, data: r.data, publishedAt: r.published_at };
  }
}
