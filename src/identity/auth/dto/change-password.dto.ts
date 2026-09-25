import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const changePasswordRequestSchema = z.object({
  current: z.string().min(1),
  new: z.string().min(12),
});

export class ChangePasswordRequestDto extends createZodDto(changePasswordRequestSchema) {}

export const changePasswordResponseSchema = z.object({
  message: z.string(),
});

export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;
