import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const staffCreateSchema = z.object({
  email: z.string().email().toLowerCase(),
  fullName: z.string().min(1).max(255),
  roleId: z.string().uuid(),
});

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;
export class CreateStaffDto extends createZodDto(staffCreateSchema) {}

const staffCreateResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  isActive: z.boolean(),
  roleId: z.string().uuid(),
  totpEnabled: z.boolean(),
  password: z.string().describe("Temporary password (returned only once)"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type StaffCreateResponse = z.infer<typeof staffCreateResponseSchema>;
export class CreateStaffResponseDto extends createZodDto(staffCreateResponseSchema) {}
