import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const bulkActionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["publish", "archive", "delete", "add_tags", "remove_tags"]),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
});

export type BulkActionInput = z.infer<typeof bulkActionSchema>;
export class BulkActionDto extends createZodDto(bulkActionSchema) {}
