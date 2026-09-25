import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const redirectCreateSchema = z.object({
  fromPath: z.string().min(1).max(500),
  toPath: z.string().min(1).max(1000),
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  isActive: z.boolean().default(true),
});
export class RedirectCreateDto extends createZodDto(redirectCreateSchema) {}

export const redirectUpdateSchema = z
  .object({
    fromPath: z.string().min(1).max(500),
    toPath: z.string().min(1).max(1000),
    statusCode: z.union([z.literal(301), z.literal(302)]),
    isActive: z.boolean(),
  })
  .partial();
export class RedirectUpdateDto extends createZodDto(redirectUpdateSchema) {}

export const redirectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(200).optional(),
});
export class RedirectListQueryDto extends createZodDto(redirectListQuerySchema) {}

export interface RedirectResponseDto {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StorefrontRedirectDto {
  from: string;
  to: string;
  status: number;
}
