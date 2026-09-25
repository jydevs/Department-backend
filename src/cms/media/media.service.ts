import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import { DataSource, Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../audit/audit.service";
import { AppException } from "../../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { escapeLike } from "../../common/sql/escape-like";
import { RequestContextStore } from "../../common/context/request-context";
import { Media } from "../../catalog/entities";
import { detectImageType } from "./image-type";
import type { MediaResponseDto, MediaUploadResultDto, MediaUsageDto } from "./media.dto";
import { STORAGE_DRIVER, type StorageDriver } from "./storage.driver";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_USAGES = 100;

type UsageRow = { id: string; label: string | null };

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(Media) private readonly repo: Repository<Media>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
  ) {}

  async upload(file: { buffer: Buffer; originalname: string } | undefined): Promise<MediaUploadResultDto> {
    if (!file || file.buffer.length === 0) throw AppException.badRequest("VALIDATION_ERROR", "A file is required in the 'file' field");
    if (file.buffer.length > MAX_UPLOAD_BYTES) throw new AppException(413, "PAYLOAD_TOO_LARGE", "File exceeds 8 MB");

    const type = detectImageType(file.buffer);
    if (!type) throw new AppException(415, "UNSUPPORTED_MEDIA_TYPE", "Only png, jpeg, webp, avif and gif images are allowed");

    let width: number;
    let height: number;
    try {
      const dim = imageSize(file.buffer);
      if (!dim.width || !dim.height) throw new Error("no dimensions");
      width = dim.width;
      height = dim.height;
    } catch {
      throw new AppException(415, "UNSUPPORTED_MEDIA_TYPE", "The file is not a valid image");
    }

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.repo.findOne({ where: { sha256 } });
    if (existing) return { media: this.toDto(existing), created: false };

    const key = `${uuidv7()}.${type.ext}`;
    const { url } = await this.storage.put(key, file.buffer, type.mime);

    let saved: Media;
    try {
      saved = await this.repo.save(
        this.repo.create({
          url,
          alt: null,
          width,
          height,
          mimeType: type.mime,
          storageKey: key,
          byteSize: file.buffer.length,
          originalName: this.cleanName(file.originalname),
          sha256,
          uploadedBy: this.actorId(),
        }),
      );
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
    await this.audit.record({ action: "media:upload", entityType: "Media", entityId: saved.id, diff: { key, byteSize: saved.byteSize, mimeType: type.mime } });
    return { media: this.toDto(saved), created: true };
  }

  async list(page: number, pageSize: number, q?: string): Promise<OffsetPage<MediaResponseDto>> {
    const qb = this.repo.createQueryBuilder("m").orderBy("m.createdAt", "DESC").addOrderBy("m.id", "DESC");
    if (q) {
      qb.where("(m.originalName ILIKE :q ESCAPE '\\' OR m.alt ILIKE :q ESCAPE '\\')", { q: `%${escapeLike(q)}%` });
    }
    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return toOffsetPage(
      rows.map((m) => this.toDto(m)),
      total,
      page,
      pageSize,
    );
  }

  async updateAlt(id: string, alt: string | null): Promise<MediaResponseDto> {
    const media = await this.mustFind(id);
    const before = media.alt ?? null;
    media.alt = alt === "" ? null : alt;
    const saved = await this.repo.save(media);
    await this.audit.record({ action: "media:update", entityType: "Media", entityId: id, diff: { alt: { from: before, to: saved.alt ?? null } } });
    return this.toDto(saved);
  }

  async usages(id: string): Promise<MediaUsageDto[]> {
    const media = await this.mustFind(id);
    const out: MediaUsageDto[] = [];
    const push = (rows: UsageRow[], type: MediaUsageDto["type"]): void => {
      for (const r of rows) if (out.length < MAX_USAGES) out.push({ type, id: r.id, label: r.label ?? r.id });
    };

    push(
      await this.dataSource.query<UsageRow[]>(
        `SELECT p.id AS id, p.title AS label FROM product_media pm JOIN products p ON p.id = pm.product_id
         WHERE pm.media_id = $1 AND p.deleted_at IS NULL LIMIT ${MAX_USAGES}`,
        [id],
      ),
      "product",
    );
    push(
      await this.dataSource.query<UsageRow[]>(`SELECT id, title AS label FROM collections WHERE image_media_id = $1 AND deleted_at IS NULL LIMIT ${MAX_USAGES}`, [id]),
      "collection",
    );

    const byUrl = `%${escapeLike(media.url)}%`;
    const byPath = media.storageKey ? `%${escapeLike(`/media/${media.storageKey}`)}%` : byUrl;
    push(
      await this.dataSource.query<UsageRow[]>(
        `SELECT id, COALESCE(title, kind || ':' || key) AS label FROM content_documents
         WHERE deleted_at IS NULL AND (draft::text LIKE $1 ESCAPE '\\' OR draft::text LIKE $2 ESCAPE '\\') LIMIT ${MAX_USAGES}`,
        [byUrl, byPath],
      ),
      "content_document",
    );
    push(
      await this.dataSource.query<UsageRow[]>(
        `SELECT v.id AS id, d.kind || ':' || d.key || ' v' || v.number AS label FROM content_versions v
         JOIN content_documents d ON d.id = v.document_id
         WHERE v.data::text LIKE $1 ESCAPE '\\' OR v.data::text LIKE $2 ESCAPE '\\' LIMIT ${MAX_USAGES}`,
        [byUrl, byPath],
      ),
      "content_version",
    );
    return out;
  }

  async remove(id: string, force: boolean): Promise<void> {
    const media = await this.mustFind(id);
    const usages = await this.usages(id);
    if (usages.length > 0 && !force) {
      throw AppException.conflict("MEDIA_IN_USE", "Media is referenced by content", { usages: usages.slice(0, 20) });
    }
    const key = media.storageKey;
    await this.repo.remove(media);
    if (key) await this.storage.delete(key);
    await this.audit.record({ action: "media:delete", entityType: "Media", entityId: id, diff: { key: key ?? null, force, usages: usages.length } });
  }

  private async mustFind(id: string): Promise<Media> {
    const media = await this.repo.findOne({ where: { id } });
    if (!media) throw AppException.notFound("Media");
    return media;
  }

  private actorId(): string | null {
    const actor = RequestContextStore.get()?.actor;
    return actor?.kind === "staff" ? actor.staffId : null;
  }

  private cleanName(name: string): string {
    // eslint-disable-next-line no-control-regex
    const cleaned = name.replace(/[\x00-\x1f\x7f]/g, "").replace(/^.*[\\/]/, "").slice(0, 255);
    return cleaned || "upload";
  }

  private toDto(m: Media): MediaResponseDto {
    return {
      id: m.id,
      url: m.url,
      alt: m.alt ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      mimeType: m.mimeType ?? null,
      byteSize: m.byteSize ?? null,
      originalName: m.originalName ?? null,
      sha256: m.sha256 ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
