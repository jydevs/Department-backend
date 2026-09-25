import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const loginRequestSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export class LoginRequestDto extends createZodDto(loginRequestSchema) {}

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().min(1),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
    role: z.string(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
