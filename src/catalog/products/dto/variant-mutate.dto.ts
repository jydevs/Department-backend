import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const variantCreateSchema = z.object({
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

export type VariantCreateInput = z.infer<typeof variantCreateSchema>;
export class CreateVariantDto extends createZodDto(variantCreateSchema) {}

const variantUpdateSchema = z.object({
  sku: z.string().max(120).nullable().optional(),
  title: z.string().min(1).max(255).optional(),
  price: z.number().int().min(0).max(1e10).optional(),
  compareAtPrice: z.number().int().min(0).max(1e10).nullable().optional(),
  weightGrams: z.number().int().nonnegative().nullable().optional(),
  barcode: z.string().max(120).nullable().optional(),
  trackInventory: z.boolean().optional(),
  allowBackorder: z.boolean().optional(),
  optionValueIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().min(0),
});

export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;
export class UpdateVariantDto extends createZodDto(variantUpdateSchema) {}

/** `/admin/products/:id/variants/:variantId` — both segments must be uuids (400, never a Postgres 500). */
const variantParamsSchema = z.object({ id: z.uuid(), variantId: z.uuid() });
export class VariantParamsDto extends createZodDto(variantParamsSchema) {}
