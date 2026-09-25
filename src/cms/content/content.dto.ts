import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { handleSlug } from "../schemas/common";
import { TEMPLATE_KEYS } from "../schemas/template.schema";
import type { ContentKind } from "../entities/content-document.entity";
import type { ContentVersionStatus } from "../entities/content-version.entity";

export const CONTENT_KINDS = ["settings", "menu", "template", "page"] as const;
export { TEMPLATE_KEYS };

export const contentKeySchema = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,119}$/);
export const contentKindSchema = z.enum(CONTENT_KINDS);

/* ── request DTOs ─────────────────────────────────────────── */

export const documentParamsSchema = z.object({ kind: contentKindSchema, key: contentKeySchema });
export class DocumentParamsDto extends createZodDto(documentParamsSchema) {}

export const versionParamsSchema = documentParamsSchema.extend({ versionId: z.uuid() });
export class VersionParamsDto extends createZodDto(versionParamsSchema) {}

export const listDocumentsQuerySchema = z.object({ kind: contentKindSchema.optional() });
export class ListDocumentsQueryDto extends createZodDto(listDocumentsQuerySchema) {}

export const upsertDraftSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  title: z.string().max(255).nullable().optional(),
  /** Optimistic lock: version of the document the client edited from (or send `If-Match`). */
  version: z.number().int().min(1).optional(),
});
export class UpsertDraftDto extends createZodDto(upsertDraftSchema) {}

export const createPageSchema = z.object({
  handle: handleSlug,
  title: z.string().min(1).max(255),
  seoTitle: z.string().max(255).optional(),
  seoDescription: z.string().max(320).optional(),
  sections: z.array(z.record(z.string(), z.unknown())).max(40).default([]),
});
export class CreatePageDto extends createZodDto(createPageSchema) {}

export const publishSchema = z.object({ note: z.string().max(255).optional() });
export class PublishDto extends createZodDto(publishSchema) {}

export const scheduleSchema = z.object({ publishAt: z.iso.datetime({ offset: true }), note: z.string().max(255).optional() });
export class ScheduleDto extends createZodDto(scheduleSchema) {}

export const scheduleParamsSchema = documentParamsSchema.extend({ versionId: z.uuid() });
export class ScheduleParamsDto extends createZodDto(scheduleParamsSchema) {}

export const previewTokenSchema = z.object({ kind: contentKindSchema, key: contentKeySchema });
export class PreviewTokenDto extends createZodDto(previewTokenSchema) {}

export const previewQuerySchema = z.object({ preview: z.string().min(1).max(4000).optional() });
export class PreviewQueryDto extends createZodDto(previewQuerySchema) {}

export const bundleQuerySchema = previewQuerySchema.extend({ template: z.enum(TEMPLATE_KEYS).default("home") });
export class BundleQueryDto extends createZodDto(bundleQuerySchema) {}

export const storefrontKeyParamsSchema = z.object({ key: contentKeySchema });
export class StorefrontKeyParamsDto extends createZodDto(storefrontKeyParamsSchema) {}

/* ── response DTOs ────────────────────────────────────────── */

export interface PublishedVersionSummaryDto {
  versionId: string;
  number: number;
  publishedAt: Date | null;
}

export interface ScheduledVersionSummaryDto {
  versionId: string;
  number: number;
  publishAt: Date | null;
}

export interface DocumentListItemDto {
  id: string;
  kind: ContentKind;
  key: string;
  title: string | null;
  version: number;
  hasUnpublishedChanges: boolean;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  draftUpdatedAt: Date;
}

export interface DocumentDetailDto {
  id: string;
  kind: ContentKind;
  key: string;
  title: string | null;
  version: number;
  draft: Record<string, unknown>;
  draftUpdatedAt: Date;
  hasUnpublishedChanges: boolean;
  published: PublishedVersionSummaryDto | null;
  scheduled: ScheduledVersionSummaryDto[];
}

export interface VersionSummaryDto {
  id: string;
  number: number;
  status: ContentVersionStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  supersededAt: Date | null;
  authorId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface VersionDetailDto extends VersionSummaryDto {
  data: Record<string, unknown>;
}

export interface PageDeletedDto {
  deleted: true;
  suggestedRedirect: { fromPath: string; toPath: string };
}

export interface PreviewTokenResponseDto {
  token: string;
  url: string;
  expiresAt: Date;
}

export interface StorefrontDocumentDto {
  kind: ContentKind;
  key: string;
  title: string | null;
  data: Record<string, unknown>;
  publishedAt: Date | null;
}

export interface StorefrontPageListItemDto {
  handle: string;
  title: string | null;
}

export interface StorefrontBundleDto {
  settings: StorefrontDocumentDto | null;
  menus: { main: StorefrontDocumentDto | null; footer: StorefrontDocumentDto | null };
  template: StorefrontDocumentDto | null;
}
