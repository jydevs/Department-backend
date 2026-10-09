import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const productOptionValueInputSchema = z.object({
  value: z.string().min(1).max(255),
  position: z.number().int().nonnegative().default(0),
});

export type ProductOptionValueInput = z.infer<typeof productOptionValueInputSchema>;
export class ProductOptionValueInputDto extends createZodDto(productOptionValueInputSchema) {}

export const productOptionValueResponseSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  position: z.number().int(),
  createdAt: z.coerce.date(),
});

export type ProductOptionValueResponse = z.infer<typeof productOptionValueResponseSchema>;
export class ProductOptionValueResponseDto extends createZodDto(productOptionValueResponseSchema) {}

export const productOptionInputSchema = z.object({
  name: z.string().min(1).max(255),
  values: z.array(productOptionValueInputSchema).min(1).max(100),
  position: z.number().int().nonnegative().default(0),
});

export type ProductOptionInput = z.infer<typeof productOptionInputSchema>;
export class ProductOptionInputDto extends createZodDto(productOptionInputSchema) {}

export const productOptionResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  position: z.number().int(),
  values: z.array(productOptionValueResponseSchema),
});

export type ProductOptionResponse = z.infer<typeof productOptionResponseSchema>;
export class ProductOptionResponseDto extends createZodDto(productOptionResponseSchema) {}
