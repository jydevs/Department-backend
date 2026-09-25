import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const auditLogSchema = z.object({
  id: z.string().uuid(),
  actorType: z.string(),
  actorId: z.string().uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  diff: z.unknown().nullable(),
  requestId: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export type AuditLogDto = z.infer<typeof auditLogSchema>;
export class AuditLogResponseDto extends createZodDto(auditLogSchema) {}
