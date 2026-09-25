import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const loginRequestSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(256),
  /** 6-digit authenticator code, or an 8-character recovery code */
  totp: z.string().regex(/^(\d{6}|[A-Z0-9]{8})$/).optional(),
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
