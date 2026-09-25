import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { decodeCursor } from "../../common/pagination/pagination";

const auditCursorSchema = z.object({
  c: z.string().datetime(),
  id: z.string().uuid(),
});

const auditQuerySchema = z.object({
  limit: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(100).default(24)),
  cursor: z.string().max(512).optional(),
  entityType: z.string().max(60).optional(),
  actorId: z.string().uuid().optional(),
});

export type AuditQueryParams = z.infer<typeof auditQuerySchema>;
export type AuditCursorPayload = z.infer<typeof auditCursorSchema>;

export class AuditQueryDto extends createZodDto(auditQuerySchema) {}

export function decodeAuditCursor(cursor: string): AuditCursorPayload {
  return decodeCursor(cursor, auditCursorSchema);
}
