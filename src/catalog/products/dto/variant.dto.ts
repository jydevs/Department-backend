import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const variantInputSchema = z.object({
  sku: z.string().max(120).nullable().optional(),
  title: z.string().min(1).max(255),
  price: z.number().int().min(0).max(1e10),
  compareAtPrice: z.number().int().min(0).max(1e10).nullable().optional(),
  weightGrams: z.number().int().nonnegative().nullable().optional(),
  barcode: z.string().max(120).nullable().optional(),
  trackInventory: z.boolean().default(true),
  allowBackorder: z.boolean().default(false),
  optionValueIds: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true),
});

export type VariantInput = z.infer<typeof variantInputSchema>;
export class VariantInputDto extends createZodDto(variantInputSchema) {}

export const variantResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string().max(120).nullable(),
  title: z.string(),
  price: z.number().int(),
  compareAtPrice: z.number().int().nullable(),
  weightGrams: z.number().int().nullable(),
  barcode: z.string().max(120).nullable(),
  position: z.number().int(),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  optionValueIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  version: z.number().int(),
});

export type VariantResponse = z.infer<typeof variantResponseSchema>;
export class VariantResponseDto extends createZodDto(variantResponseSchema) {}
