import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const refreshRequestSchema = z.object({});

export class RefreshRequestDto extends createZodDto(refreshRequestSchema) {}

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().min(1),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
