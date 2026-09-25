import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { IMPORT_STATUSES, IMPORT_TYPES, type ImportRowError, type ImportStatus, type ImportType } from "./entities/import-job.entity";

/** Multipart text fields arrive as strings. */
const booleanField = z.preprocess((v) => {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "1", "yes"].includes(t)) return true;
    if (["false", "0", "no", ""].includes(t)) return false;
  }
  return v;
}, z.boolean());

export const createImportSchema = z.object({
  type: z.enum(IMPORT_TYPES),
  dryRun: booleanField.default(false),
});
export class CreateImportDto extends createZodDto(createImportSchema) {}

export const listImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(IMPORT_STATUSES).optional(),
  type: z.enum(IMPORT_TYPES).optional(),
});
export class ListImportsQueryDto extends createZodDto(listImportsQuerySchema) {}

/* ── responses ────────────────────────────────────────────── */

export interface ImportJobSummaryDto {
  id: string;
  type: ImportType;
  status: ImportStatus;
  dryRun: boolean;
  fileName: string;
  fileSha256: string;
  totalRows: number;
  processedRows: number;
  /** 0-100. */
  progressPercent: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

/** Detail adds the stored errors (at most 200; `errorCount` may be larger). Errors never contain cell values. */
export interface ImportJobDetailDto extends ImportJobSummaryDto {
  errors: ImportRowError[];
  errorsTruncated: boolean;
}
