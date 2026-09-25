import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const staffResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  isActive: z.boolean(),
  roleId: z.string().uuid(),
  totpEnabled: z.boolean(),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type StaffResponseDto = z.infer<typeof staffResponseSchema>;
export class StaffDto extends createZodDto(staffResponseSchema) {}
