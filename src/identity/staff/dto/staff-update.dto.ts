import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const staffUpdateSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;
export class UpdateStaffDto extends createZodDto(staffUpdateSchema) {}
