import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const roleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
});

export type RoleResponseDto = z.infer<typeof roleResponseSchema>;
export class RoleDto extends createZodDto(roleResponseSchema) {}
