import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { pageQuerySchema } from "../../common/pagination/pagination";

export const mediaListQuerySchema = pageQuerySchema.extend({ q: z.string().trim().max(100).optional() });
export class MediaListQueryDto extends createZodDto(mediaListQuerySchema) {}

export const mediaUpdateSchema = z.object({ alt: z.string().trim().max(300).nullable() });
export class UpdateMediaAltDto extends createZodDto(mediaUpdateSchema) {}

export const mediaDeleteQuerySchema = z.object({
  force: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export class MediaDeleteQueryDto extends createZodDto(mediaDeleteQuerySchema) {}

export interface MediaResponseDto {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  byteSize: number | null;
  originalName: string | null;
  sha256: string | null;
  createdAt: string;
}

export interface MediaUploadResultDto {
  media: MediaResponseDto;
  created: boolean;
}

export interface MediaUsageDto {
  type: "product" | "collection" | "content_document" | "content_version";
  id: string;
  label: string;
}
