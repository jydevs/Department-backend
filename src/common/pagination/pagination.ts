import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { AppException } from "../errors/app-exception";

/* ── request side ─────────────────────────────────────────── */

/** Cursor (keyset) pagination: for storefront feeds where offsets would drift. */
export const cursorQuerySchema = z.object({
  limit: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(100).default(24)),
  cursor: z.string().max(512).optional(),
});
export class CursorQueryDto extends createZodDto(cursorQuerySchema) {}

/** Page/size pagination: for admin tables that need a total and page jumps. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1), // deep OFFSETs are slow: cap them
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export class PageQueryDto extends createZodDto(pageQuerySchema) {}

/* ── response side ────────────────────────────────────────── */

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Turn `limit + 1` fetched rows into a page: the extra row only signals that more exist.
 * `cursorOf` builds the opaque cursor from the last row that is actually returned.
 */
export function toCursorPage<T>(rows: T[], limit: number, cursorOf: (last: T) => Record<string, string | number>): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}

export function toOffsetPage<T>(items: T[], total: number, page: number, pageSize: number): OffsetPage<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/* ── opaque cursors ───────────────────────────────────────── */

export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode + validate. A malformed cursor is a client error, never a 500. */
export function decodeCursor<S extends z.ZodType>(cursor: string, shape: S): z.infer<S> {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const parsed = shape.safeParse(json);
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through */
  }
  throw AppException.badRequest("INVALID_CURSOR", "Invalid pagination cursor");
}
